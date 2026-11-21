//! Projects the configured image model names and binds tool selections before approval.
use serde::Serialize;
use serde_json::Value;

use super::{
    runtime::{ExecContext, PendingInteraction},
    tool_call_result::{complete_image, ToolResultSender},
};
use crate::{
    model::{ModelConfig, ToolCall},
    provider::image_generation,
    store::Store,
    Error, Result,
};

#[derive(Clone, Debug, Serialize)]
pub struct ImageModel {
    pub id: String,
    pub model: String,
    pub name: String,
}

pub(crate) fn generate(
    results: ToolResultSender,
    store: Store,
    pending: PendingInteraction,
    request: ImageRequest,
    approved_prompt: String,
) {
    tokio::spawn(async move {
        let outcome = async {
            let model = store
                .model(&request.model_hash)
                .await?
                .filter(ModelConfig::is_image_generation)
                .ok_or_else(|| {
                    Error::Config("The selected image model is no longer configured".into())
                })?;
            let args = &pending.call.arguments;
            let prompt = if approved_prompt.trim().is_empty() {
                args["description"].as_str().unwrap_or_default()
            } else {
                &approved_prompt
            };
            let image = image_generation::generate(
                &store,
                &model,
                &request.conversation_id,
                prompt,
                args["aspect_ratio"].as_str(),
            )
            .await?;
            tracing::debug!(
                mime_type = image.mime_type,
                "received image for Cursor workspace"
            );
            Ok::<_, Error>((request.output_path(image.extension), image.data))
        };
        let outcome = tokio::select! {
            biased;
            _ = results.closed() => return,
            result = outcome => result,
        };
        match outcome {
            Ok((path, bytes)) => {
                results.image_write(pending.call, pending.started_at_ms, path, bytes)
            }
            Err(error) => {
                match complete_image(&pending.call, pending.started_at_ms, Err(error.to_string())) {
                    Ok(completion) => results.send(completion),
                    Err(error) => results.send_error(error),
                }
            }
        }
    });
}

pub(crate) fn catalog(models: Vec<ModelConfig>) -> Vec<ImageModel> {
    let mut images: Vec<_> = models
        .into_iter()
        .filter(ModelConfig::is_image_generation)
        .collect();
    images.sort_by(|a, b| {
        (a.sort_order, &a.display_name, &a.model_hash).cmp(&(
            b.sort_order,
            &b.display_name,
            &b.model_hash,
        ))
    });
    images
        .into_iter()
        .map(|model| ImageModel {
            id: model.model_hash,
            model: model.model_id,
            name: model.display_name,
        })
        .collect()
}

#[derive(Debug)]
pub(crate) struct ImageRequest {
    model_hash: String,
    conversation_id: String,
    workspace: String,
    stem: String,
}

impl ImageRequest {
    pub fn prepare(call: &ToolCall, context: &ExecContext) -> Result<Self> {
        let args = &call.arguments;
        if args
            .get("reference_image_paths")
            .is_some_and(|value| !value.as_array().is_some_and(Vec::is_empty))
        {
            return Err(Error::Protocol(
                "GenerateImage supports text prompts only".into(),
            ));
        }
        if args
            .get("description")
            .and_then(Value::as_str)
            .is_none_or(|text| text.trim().is_empty())
        {
            return Err(Error::Protocol(
                "GenerateImage requires a non-empty description".into(),
            ));
        }
        if let Some(ratio) = args.get("aspect_ratio") {
            if !matches!(
                ratio.as_str(),
                Some("1:1" | "4:3" | "3:4" | "16:9" | "9:16")
            ) {
                return Err(Error::Protocol(
                    "Unsupported GenerateImage aspect_ratio".into(),
                ));
            }
        }
        let model = select_model(&context.image_models, args.get("model"))?;
        if context.workspace_path.is_empty() {
            return Err(Error::Protocol(
                "Open a Cursor workspace to save generated images".into(),
            ));
        }
        let filename = args
            .get("filename")
            .map(|value| {
                value.as_str().ok_or_else(|| {
                    Error::Protocol("GenerateImage filename must be a string".into())
                })
            })
            .transpose()?
            .unwrap_or("image");
        if filename.is_empty()
            || filename.len() > 160
            || filename.starts_with('.')
            || filename
                .chars()
                .any(|c| c.is_control() || r#"\/:*?"<>|"#.contains(c))
        {
            return Err(Error::Protocol(
                "GenerateImage filename must be a plain filename without a directory".into(),
            ));
        }
        let stem = filename.rsplit_once('.').map_or(filename, |(stem, _)| stem);
        Ok(Self {
            model_hash: model.id.clone(),
            conversation_id: context.conversation_id.clone(),
            workspace: context.workspace_path.clone(),
            stem: stem.to_owned(),
        })
    }

    fn output_path(&self, extension: &str) -> String {
        // Use client path syntax even when a Linux BYOK server serves a Windows workspace.
        let separator = if self.workspace.contains('\\') {
            '\\'
        } else {
            '/'
        };
        format!(
            "{}{separator}{}-{}.{}",
            self.workspace.trim_end_matches(['/', '\\']),
            self.stem,
            uuid::Uuid::new_v4().simple(),
            extension
        )
    }
}

fn select_model<'a>(
    catalog: &'a [ImageModel],
    selection: Option<&Value>,
) -> Result<&'a ImageModel> {
    let Some(selection) = selection else {
        return catalog
            .first()
            .ok_or_else(|| Error::Protocol("No image generation models configured".into()));
    };
    let id = selection
        .as_str()
        .ok_or_else(|| Error::Protocol("GenerateImage model must be a catalog ID".into()))?;
    if let Some(model) = catalog.iter().find(|model| model.id == id) {
        return Ok(model);
    }
    let mut matching = catalog
        .iter()
        .filter(|model| model.model == id || model.name == id);
    let model = matching
        .next()
        .ok_or_else(|| Error::Protocol(format!("Unknown configured image model: {id}")))?;
    if matching.next().is_some() {
        return Err(Error::Protocol(format!(
            "Ambiguous image model {id}; pass the configuration ID from image_generation_models"
        )));
    }
    Ok(model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context() -> ExecContext {
        let image = |id: &str| ImageModel {
            id: id.into(),
            model: "image-v1".into(),
            name: "Image".into(),
        };
        ExecContext {
            workspace_path: r"C:\project".into(),
            image_models: vec![image("first"), image("second")],
            ..Default::default()
        }
    }

    fn call(args: serde_json::Value) -> ToolCall {
        ToolCall {
            index: 0,
            call_id: "image-call".into(),
            model_call_id: "cycle".into(),
            name: "GenerateImage".into(),
            arguments_text: args.to_string(),
            arguments: args,
            argument_error: None,
        }
    }

    #[test]
    fn selects_default_or_unique_config_and_rejects_ambiguous_upstream_id() {
        let context = context();
        let selection = |model: Option<&str>| {
            let mut args = json!({"description": "a boat"});
            if let Some(model) = model {
                args["model"] = json!(model);
            }
            ImageRequest::prepare(&call(args), &context)
        };
        assert_eq!(selection(None).unwrap().model_hash, "first");
        assert_eq!(selection(Some("second")).unwrap().model_hash, "second");
        assert!(selection(Some("image-v1"))
            .unwrap_err()
            .to_string()
            .contains("Ambiguous"));
        assert!(selection(Some("missing")).is_err());
        assert!(selection(Some("Image"))
            .unwrap_err()
            .to_string()
            .contains("Ambiguous"));
    }

    #[test]
    fn generates_unique_workspace_filename_and_rejects_unusable_requests_before_approval() {
        let ctx = context();
        let request = ImageRequest::prepare(
            &call(json!({"description":"boat", "filename":"boat.jpg"})),
            &ctx,
        )
        .unwrap();
        let first = request.output_path("png");
        assert!(first.starts_with(r"C:\project\boat-") && first.ends_with(".png"));
        assert_ne!(first, request.output_path("png"));
        for extra in [
            json!({"reference_image_paths":["picture.png"]}),
            json!({"filename":"../outside"}),
            json!({"filename":"C:\\other"}),
            json!({"aspect_ratio":"bad"}),
            json!({"description":""}),
        ] {
            let mut args = json!({"description":"boat"});
            args.as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            assert!(ImageRequest::prepare(&call(args), &ctx).is_err());
        }
    }
}
