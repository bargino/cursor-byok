//! Serves one Cursor RunInference stream: run setup, model invocations, cancellation, finish.
use std::{collections::HashMap, sync::Arc};

use bytes::Bytes;
use tokio::sync::mpsc;
use tokio_stream::StreamExt;
use tokio_util::sync::CancellationToken;

use crate::{
    cursor::{
        compile::inference_model,
        protocol::{
            connect::{self, ConnectCode, ConnectStreamError},
            proto::aiserver::v1::{
                run_inference_client_message::Message, InferenceRequestedModel,
                RunInferenceClientMessage, RunInferenceInvokeModel, RunInferenceRunRequest,
                RunInferenceServerMessage,
            },
        },
        transport::{OrderedInbox, OutputHub},
    },
    model::{ModelInvocation, ModelSpec},
    provider::Provider,
    Error, Result,
};

use super::{request, response, ByokModel};

pub struct InferenceSession {
    request_id: String,
    byok: ByokModel,
    provider: Arc<dyn Provider>,
    output: OutputHub,
    finished: CancellationToken,
    state: parking_lot::Mutex<State>,
}

struct State {
    inbox: OrderedInbox<RunInferenceClientMessage>,
    run: Option<Run>,
    invocations: HashMap<String, CancellationToken>,
    provider_calls: u64,
}

#[derive(Clone)]
struct Run {
    conversation_id: String,
    requested: InferenceRequestedModel,
    model: ModelSpec,
}

impl InferenceSession {
    pub(super) fn new(request_id: String, byok: ByokModel, provider: Arc<dyn Provider>) -> Self {
        Self {
            request_id,
            byok,
            provider,
            output: OutputHub::default(),
            finished: CancellationToken::new(),
            state: parking_lot::Mutex::new(State {
                inbox: OrderedInbox::starting_at(0),
                run: None,
                invocations: HashMap::new(),
                provider_calls: 0,
            }),
        }
    }

    pub fn subscribe(&self) -> mpsc::UnboundedReceiver<Bytes> {
        self.output.subscribe()
    }

    /// Resolves once the stream has ended, by finish, failure, or disconnect.
    pub async fn finished(&self) {
        self.finished.cancelled().await;
    }

    /// Accepts one BidiAppend message and processes every message now in sequence.
    pub fn append(self: &Arc<Self>, seqno: i64, message: RunInferenceClientMessage) {
        let mut state = self.state.lock();
        for (_, message) in state.inbox.push(seqno, message) {
            if self.finished.is_cancelled() {
                return;
            }
            if let Err(error) = self.handle(&mut state, message) {
                tracing::warn!(request_id = self.request_id, %error, "Cursor RunInference stream failed");
                drop(state);
                self.close(Some(error));
                return;
            }
        }
    }

    /// Ends the stream because Cursor stopped listening.
    pub fn disconnect(&self) {
        self.close(None);
    }

    fn handle(
        self: &Arc<Self>,
        state: &mut State,
        message: RunInferenceClientMessage,
    ) -> Result<()> {
        match message.message {
            Some(Message::RunRequest(run)) => self.start(state, run),
            Some(Message::InvokeModel(invoke)) => {
                let run = state.run.clone().ok_or_else(|| {
                    Error::Protocol("Cursor RunInference invoked a model before run_request".into())
                })?;
                state.provider_calls += 1;
                self.invoke(state, &run, invoke, state.provider_calls - 1);
                Ok(())
            }
            Some(Message::CancelInvocation(cancel)) => {
                if let Some(token) = state.invocations.get(&cancel.invocation_id) {
                    token.cancel();
                }
                Ok(())
            }
            Some(Message::FinishRun(_)) => {
                for token in state.invocations.values() {
                    token.cancel();
                }
                self.emit_frame(connect::encode_end_stream());
                self.output.close();
                self.finished.cancel();
                Ok(())
            }
            Some(Message::ClientHeartbeat(_)) => {
                self.emit(&response::heartbeat());
                Ok(())
            }
            Some(
                Message::AgentEvent(_)
                | Message::RunRequestLog(_)
                | Message::ResolveSubagentModels(_)
                | Message::ClientFirstCallTimings(_),
            )
            | None => Ok(()),
        }
    }

    fn start(&self, state: &mut State, run: RunInferenceRunRequest) -> Result<()> {
        if state.run.is_some() {
            return Err(Error::Protocol(
                "Cursor RunInference sent a second run_request".into(),
            ));
        }
        let requested = run.requested_model.ok_or_else(|| {
            Error::Protocol("Cursor RunInference run_request does not select a model".into())
        })?;
        let model = self.model(&requested)?;
        self.emit(&response::run_ready(
            &requested,
            self.byok.provider_type(),
            &model,
        ));
        state.run = Some(Run {
            conversation_id: run.conversation_id,
            requested,
            model,
        });
        Ok(())
    }

    fn invoke(
        self: &Arc<Self>,
        state: &mut State,
        run: &Run,
        invoke: RunInferenceInvokeModel,
        index: u64,
    ) {
        let invocation_id = invoke.invocation_id.clone();
        let invocation = match self.invocation(run, invoke, index) {
            Ok(invocation) => invocation,
            Err(error) => {
                self.emit(&response::invocation_end(
                    &invocation_id,
                    Some((false, error.to_string())),
                ));
                return;
            }
        };
        let token = self.finished.child_token();
        state
            .invocations
            .insert(invocation_id.clone(), token.clone());
        let mut encoder = response::ResponseEncoder::new(
            &invocation_id,
            invocation.request.model.context_window_tokens,
        );
        self.emit(&encoder.opening());
        let session = self.clone();
        tokio::spawn(async move {
            let mut stream = session.provider.stream(invocation, token.clone());
            let mut failure = None;
            loop {
                let event = tokio::select! {
                    event = stream.next() => event,
                    () = token.cancelled() => break,
                };
                let Some(event) = event else {
                    break;
                };
                match event {
                    Ok(event) => {
                        for message in encoder.encode(event) {
                            session.emit(&message);
                        }
                    }
                    Err(error) => {
                        failure = Some((token.is_cancelled(), error.to_string()));
                        break;
                    }
                }
            }
            if failure.is_none() && token.is_cancelled() {
                failure = Some((true, "invocation canceled".into()));
            }
            session.state.lock().invocations.remove(&invocation_id);
            session.emit(&response::invocation_end(&invocation_id, failure));
        });
    }

    fn invocation(
        &self,
        run: &Run,
        invoke: RunInferenceInvokeModel,
        index: u64,
    ) -> Result<ModelInvocation> {
        let request = invoke.request.ok_or_else(|| {
            Error::Protocol("Cursor RunInference invoke_model has no uncompressed request".into())
        })?;
        let model = match request.requested_model.as_ref() {
            Some(requested) if requested.model_id == run.requested.model_id => {
                self.model(requested)?
            }
            _ => run.model.clone(),
        };
        Ok(ModelInvocation {
            call_id: format!("{}:{}", self.request_id, invoke.invocation_id),
            run_id: self.request_id.clone(),
            conversation_id: run.conversation_id.clone(),
            provider_call_index: index,
            request: request::model_request(&request, model)?,
        })
    }

    /// The model Cursor selected, completed from the saved BYOK settings as `agent.v1` Runs are.
    fn model(&self, requested: &InferenceRequestedModel) -> Result<ModelSpec> {
        let mut model = inference_model(requested)?;
        self.byok.configure(&mut model);
        Ok(model)
    }

    fn close(&self, error: Option<Error>) {
        for token in self.state.lock().invocations.values() {
            token.cancel();
        }
        if let Some(error) = error {
            let frame = connect::encode_error_end_stream(&ConnectStreamError {
                code: ConnectCode::InvalidArgument,
                message: error.to_string(),
                details: Vec::new(),
            });
            if let Ok(frame) = frame {
                self.emit_frame(frame);
            }
        }
        self.output.close();
        self.finished.cancel();
    }

    fn emit(&self, message: &RunInferenceServerMessage) {
        match connect::encode_message(message) {
            Ok(frame) => self.emit_frame(frame),
            Err(error) => {
                tracing::error!(request_id = self.request_id, %error, "cannot encode RunInference frame")
            }
        }
    }

    fn emit_frame(&self, frame: Bytes) {
        self.output.emit(frame);
    }
}
