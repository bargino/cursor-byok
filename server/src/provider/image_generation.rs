//! Calls a configured OpenAI-compatible Images API for one approved generation.
use std::{io::Cursor, time::Duration};

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader};
use reqwest::{Client, Response, Url};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{model::ModelConfig, network, store::Store, Error, Result};

const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = MAX_IMAGE_BYTES.div_ceil(3) * 4 + 64 * 1024;

pub(crate) struct GeneratedImage {
    pub data: Vec<u8>,
    pub mime_type: &'static str,
    pub extension: &'static str,
}

#[derive(Deserialize)]
struct ImagesResponse {
    data: Vec<ImageOutput>,
}

#[derive(Deserialize)]
struct ImageOutput {
    b64_json: Option<String>,
    url: Option<String>,
}

pub(crate) async fn generate(
    store: &Store,
    model: &ModelConfig,
    conversation_id: &str,
    prompt: &str,
    aspect_ratio: Option<&str>,
) -> Result<GeneratedImage> {
    if !model.is_image_generation() {
        return Err(Error::Config(
            "a configured image generation model is required".into(),
        ));
    }
    let request_url = model.request_url()?;
    let body = request_body(model, conversation_id, prompt, aspect_ratio)?;
    let client = network::client_builder(store)
        .await?
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10 * 60))
        .build()?;
    let mut request = client.post(&request_url).bearer_auth(&model.api_key);
    if model.custom_headers_enabled {
        request = request.headers(super::custom_headers(
            &model.custom_headers,
            conversation_id,
        )?);
    }
    let response = request
        .json(&body)
        .send()
        .await
        .map_err(reqwest::Error::without_url)?;
    let status = response.status();
    if !status.is_success() {
        // Upstream bodies and URLs can echo credentials, signed links or the original prompt.
        return Err(Error::Provider(format!(
            "image generation failed (HTTP {status})"
        )));
    }
    let bytes = read_limited(response, MAX_RESPONSE_BYTES).await?;
    let output: ImagesResponse = serde_json::from_slice(&bytes)
        .map_err(|_| Error::Provider("invalid JSON from image generation endpoint".into()))?;
    let image = output
        .data
        .into_iter()
        .next()
        .ok_or_else(|| Error::Provider("image generation returned no image".into()))?;
    let data = if let Some(encoded) = image.b64_json.filter(|value| !value.is_empty()) {
        STANDARD
            .decode(encoded)
            .map_err(|_| Error::Provider("image generation returned invalid base64".into()))?
    } else if let Some(url) = image.url {
        download_image(&client, &request_url, &url).await?
    } else {
        return Err(Error::Provider(
            "image generation response has no image data".into(),
        ));
    };
    validate_image(data)
}

fn request_body(
    model: &ModelConfig,
    conversation_id: &str,
    prompt: &str,
    aspect_ratio: Option<&str>,
) -> Result<Value> {
    if prompt.trim().is_empty() {
        return Err(Error::Protocol(
            "image generation requires a description".into(),
        ));
    }
    let extra = super::request_template::render_json_strings(model.extra_params(), conversation_id);
    let mut body = json!({ "model": model.model_id, "prompt": prompt, "n": 1 });
    for key in ["prompt", "n"] {
        if extra.get(key).is_some() {
            return Err(Error::Config(format!(
                "image model extra params cannot replace {key}"
            )));
        }
    }
    super::merge_extra_params(&mut body, &extra)?;
    if let Some(ratio) = aspect_ratio {
        let exact = match ratio {
            "1:1" => "1024x1024",
            "4:3" => "1536x1152",
            "3:4" => "1152x1536",
            "16:9" => "1536x864",
            "9:16" => "864x1536",
            _ => return Err(Error::Protocol("unsupported image aspect ratio".into())),
        };
        let size = match model.model_id.rsplit('/').next().unwrap_or_default() {
            id if id.starts_with("gpt-image-1") => match ratio {
                "4:3" | "16:9" => "1536x1024",
                "3:4" | "9:16" => "1024x1536",
                _ => exact,
            },
            "dall-e-3" => match ratio {
                "4:3" | "16:9" => "1792x1024",
                "3:4" | "9:16" => "1024x1792",
                _ => exact,
            },
            "dall-e-2" => "1024x1024",
            _ => exact,
        };
        // Some gateways only accept their own preset sizes. Keep a configured size
        // authoritative and communicate the requested composition to the image model.
        let size = body
            .get("size")
            .and_then(Value::as_str)
            .unwrap_or(size)
            .to_owned();
        if size != exact {
            body["prompt"] = json!(format!(
                "{prompt}\nCompose the image for a {ratio} aspect ratio."
            ));
        }
        body["size"] = json!(size);
    }
    Ok(body)
}

async fn download_image(client: &Client, endpoint: &str, location: &str) -> Result<Vec<u8>> {
    let endpoint =
        Url::parse(endpoint).map_err(|_| Error::Config("invalid image endpoint".into()))?;
    let asset = endpoint
        .join(location)
        .map_err(|_| Error::Provider("invalid image URL".into()))?;
    // Never give a provider-directed GET access to other services on this machine or its LAN.
    if asset.origin() != endpoint.origin()
        || !asset.username().is_empty()
        || asset.password().is_some()
    {
        return Err(Error::Provider(
            "image host differs from the configured endpoint; configure the provider to return b64_json".into(),
        ));
    }
    let response = client
        .get(asset)
        .send()
        .await
        .map_err(reqwest::Error::without_url)?;
    if !response.status().is_success() {
        return Err(Error::Provider(format!(
            "image download failed (HTTP {})",
            response.status()
        )));
    }
    read_limited(response, MAX_IMAGE_BYTES).await
}

async fn read_limited(mut response: Response, limit: usize) -> Result<Vec<u8>> {
    let too_large = || Error::Provider("image generation response exceeds the size limit".into());
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(too_large());
    }
    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(reqwest::Error::without_url)?
    {
        if chunk.len() > limit - data.len() {
            return Err(too_large());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(data)
}

fn validate_image(data: Vec<u8>) -> Result<GeneratedImage> {
    if data.len() > MAX_IMAGE_BYTES {
        return Err(Error::Provider("generated image exceeds 16 MiB".into()));
    }
    let format = image::guess_format(&data)
        .map_err(|_| Error::Provider("provider returned unrecognized image data".into()))?;
    let extension = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        ImageFormat::Gif => "gif",
        _ => {
            return Err(Error::Provider(
                "provider returned an unsupported image format".into(),
            ))
        }
    };
    ImageReader::with_format(Cursor::new(&data), format)
        .into_dimensions()
        .map_err(|_| Error::Provider("provider returned a malformed image".into()))?;
    Ok(GeneratedImage {
        data,
        mime_type: format.to_mime_type(),
        extension,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        http::HeaderMap,
        routing::{get, post},
        Json, Router,
    };
    use std::sync::{Arc, Mutex};

    fn png() -> Vec<u8> {
        let mut out = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(1, 1)
            .write_to(&mut out, ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[tokio::test]
    async fn images_api_uses_configured_credentials_and_returns_checked_image_bytes() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let capture = received.clone();
        let app = Router::new()
            .route(
                "/v1/images/generations",
                post(move |headers: HeaderMap, Json(body): Json<Value>| {
                    let capture = capture.clone();
                    async move {
                        capture.lock().unwrap().push((headers, body.clone()));
                        let image = match body["prompt"].as_str().unwrap() {
                            "relative URL" => json!({"url": "/assets/test.png"}),
                            "untrusted URL" => json!({"url": "http://127.0.0.1:1/private"}),
                            "invalid bytes" => {
                                json!({"b64_json": STANDARD.encode(b"not an image")})
                            }
                            _ => json!({"b64_json": STANDARD.encode(png())}),
                        };
                        Json(json!({"data": [image]}))
                    }
                }),
            )
            .route(
                "/assets/test.png",
                get(|headers: HeaderMap| async move {
                    assert!(!headers.contains_key("authorization"));
                    assert!(!headers.contains_key("x-conversation"));
                    png()
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let store = Store::connect(&format!(
            "sqlite://{}",
            dir.path().join("test.db").display()
        ))
        .await
        .unwrap();
        let mut model = store.create_model(&serde_json::from_value(json!({
            "display_name":"Studio", "type":"openai", "base_url":format!("http://{address}/v1"),
            "api_key":"test-image-key", "model_id":"provider-image", "tooltip_data":"Studio",
            "openai_endpoint":"/v1/images/generations","custom_headers_enabled":true,
            "custom_headers":{"x-conversation":"{{SessionId}}"},"openai_extra_params_enabled":true,
            "openai_extra_params":{"quality":"high"}
        })).unwrap()).await.unwrap();
        for prompt in ["draw a flower", "relative URL"] {
            let output = generate(&store, &model, "conversation-1", prompt, Some("16:9"))
                .await
                .unwrap();
            assert_eq!(output.data, png());
            assert_eq!((output.extension, output.mime_type), ("png", "image/png"));
        }
        for prompt in ["untrusted URL", "invalid bytes"] {
            assert!(generate(&store, &model, "conversation-1", prompt, None)
                .await
                .is_err());
        }
        model.model_id = "gpt-image-1.5".into();
        let landscape = request_body(&model, "conversation-1", "panorama", Some("16:9")).unwrap();
        assert_eq!(landscape["size"], "1536x1024");
        assert!(landscape["prompt"].as_str().unwrap().contains("16:9"));
        model.openai_extra_params = json!({"size":"1792x1024"});
        let preset = request_body(&model, "conversation-1", "panorama", Some("16:9")).unwrap();
        assert_eq!(preset["size"], "1792x1024");
        for key in ["model", "prompt", "n", "stream"] {
            model.openai_extra_params = json!({(key):"override"});
            assert!(generate(&store, &model, "conversation-1", "override", None)
                .await
                .is_err());
        }
        let requests = received.lock().unwrap();
        assert_eq!(requests.len(), 4);
        let (headers, body) = &requests[0];
        assert_eq!(headers["authorization"], "Bearer test-image-key");
        assert_eq!(headers["x-conversation"], "conversation-1");
        assert_eq!(
            body,
            &json!({"model":"provider-image","prompt":"draw a flower","n":1,"size":"1536x864","quality":"high"})
        );
        assert!(requests[2].1.get("size").is_none());
        server.abort();
    }
}
