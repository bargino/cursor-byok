//! Converts completed Tool work into canonical Tool results.
mod exec;
mod gate;
mod interaction;
mod local;
mod mcp;
mod mcp_state;
mod search;

use tokio::sync::mpsc;

use crate::{
    cursor::protocol::proto::agent::v1 as pb,
    model::{ToolCall, ToolImageReference, ToolResult},
    store::BlobId,
    Error, Result,
};

use super::runtime::now_ms;

pub(crate) use exec::{edit_failure, from_exec};
pub(crate) use interaction::{
    complete_image, complete_web_fetch, complete_web_search, from_interaction,
};
pub(crate) use local::{local, subagents_disabled, todo_items};
pub(crate) use mcp::failure as mcp_failure;
pub(crate) use search::complete as semble;

#[derive(Clone, Debug)]
pub struct ToolCompletion {
    result: ToolResult,
    tool_call: pb::ToolCall,
    read_image: Option<ReadImage>,
}

#[derive(Clone, Debug)]
pub(crate) struct ReadImage {
    pub(crate) data: Vec<u8>,
    pub(crate) mime_type: String,
    pub(crate) path: String,
}

impl ToolCompletion {
    pub fn result(&self) -> &ToolResult {
        &self.result
    }

    pub fn tool_call(&self) -> &pb::ToolCall {
        &self.tool_call
    }

    pub(super) fn with_read_image(mut self, image: Option<ReadImage>) -> Self {
        self.read_image = image;
        self
    }

    pub(crate) fn take_read_image(&mut self) -> Option<ReadImage> {
        self.read_image.take()
    }

    pub(crate) fn persist_read_image(&mut self, blob_id: &BlobId, image: &ReadImage) -> Result<()> {
        self.result.content = format!("Read image file: {}", image.path);
        self.result.image = Some(ToolImageReference {
            blob_id: blob_id.to_base64(),
            mime_type: image.mime_type.clone(),
            path: image.path.clone(),
        });
        let Some(pb::tool_call::Tool::ReadToolCall(call)) = self.tool_call.tool.as_mut() else {
            return Err(Error::Protocol(
                "Read image completion has no Read tool state".into(),
            ));
        };
        let Some(pb::read_tool_result::Result::Success(success)) = call
            .result
            .as_mut()
            .and_then(|result| result.result.as_mut())
        else {
            return Err(Error::Protocol(
                "Read image completion has no success state".into(),
            ));
        };
        success.output = Some(pb::read_tool_success::Output::DataBlobId(
            blob_id.as_bytes().to_vec(),
        ));
        Ok(())
    }

    pub(crate) fn new(
        call: &ToolCall,
        started_at_ms: u64,
        mut result: ToolResult,
        mut tool: pb::tool_call::Tool,
    ) -> Self {
        // Apply the model-visible size gate once, at the tool completion
        // boundary. Canonical history and every provider projection then
        // carry the same bounded result without reprocessing it.
        gate::tool_completion(&call.name, &mut tool, &mut result.content);
        Self {
            result,
            tool_call: pb::ToolCall {
                tool_call_id: Some(call.call_id.clone()),
                started_at_ms: Some(started_at_ms),
                completed_at_ms: Some(now_ms()),
                tool: Some(tool),
                hook_additional_contexts: Vec::new(),
            },
            read_image: None,
        }
    }

    pub(super) fn from_rendered(
        call: &ToolCall,
        started_at_ms: u64,
        output: String,
        is_error: bool,
        rendered: pb::ToolCall,
    ) -> Result<Self> {
        let tool = rendered.tool.ok_or_else(|| {
            Error::Protocol(format!("tool {} has no Cursor representation", call.name))
        })?;
        Ok(Self::new(
            call,
            started_at_ms,
            ToolResult {
                call_id: call.call_id.clone(),
                content: output,
                is_error,
                image: None,
            },
            tool,
        ))
    }
}

pub enum ToolWork {
    Completed(Box<ToolCompletion>),
    ImageWrite {
        call: Box<ToolCall>,
        started_at_ms: u64,
        path: String,
        bytes: Vec<u8>,
    },
}

#[derive(Clone)]
pub struct ToolResultSender(mpsc::UnboundedSender<Result<ToolWork>>);
pub struct ToolResultReceiver(mpsc::UnboundedReceiver<Result<ToolWork>>);

pub fn tool_result_channel() -> (ToolResultSender, ToolResultReceiver) {
    let (sender, receiver) = mpsc::unbounded_channel();
    (ToolResultSender(sender), ToolResultReceiver(receiver))
}

impl ToolResultSender {
    pub fn send(&self, result: ToolCompletion) {
        let _ = self.0.send(Ok(ToolWork::Completed(Box::new(result))));
    }

    pub(crate) fn image_write(
        &self,
        call: ToolCall,
        started_at_ms: u64,
        path: String,
        bytes: Vec<u8>,
    ) {
        let _ = self.0.send(Ok(ToolWork::ImageWrite {
            call: Box::new(call),
            started_at_ms,
            path,
            bytes,
        }));
    }

    pub(crate) async fn closed(&self) {
        self.0.closed().await
    }

    pub fn send_error(&self, error: Error) {
        let _ = self.0.send(Err(error));
    }
}

impl ToolResultReceiver {
    pub async fn recv(&mut self) -> Option<Result<ToolWork>> {
        self.0.recv().await
    }
}
