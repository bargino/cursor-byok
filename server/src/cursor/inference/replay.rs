//! Carries provider reasoning replay state through Cursor's redacted reasoning parts.
//!
//! Cursor's agent harness stores redacted reasoning opaquely and sends it back on the next
//! invocation, which is where BYOK providers need their signed or encrypted reasoning.
use serde_json::{json, Value};

use crate::model::ProviderReplayState;

const TAG: &str = "cursor_byok_replay";

pub fn encode(state: &ProviderReplayState) -> String {
    json!({ TAG: { "provider_kind": state.provider_kind, "value": state.value } }).to_string()
}

pub fn decode(data: &str) -> Option<ProviderReplayState> {
    let envelope = serde_json::from_str::<Value>(data).ok()?;
    let state = envelope.get(TAG)?;
    Some(ProviderReplayState {
        provider_kind: state.get("provider_kind")?.as_str()?.to_owned(),
        value: state.get("value")?.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_state_round_trips_and_foreign_redactions_are_ignored() {
        let state = ProviderReplayState {
            provider_kind: "anthropic".into(),
            value: json!({ "blocks": [{ "type": "thinking", "signature": "sig" }] }),
        };
        assert_eq!(decode(&encode(&state)), Some(state));
        assert_eq!(decode("opaque-provider-bytes"), None);
        assert_eq!(decode(r#"{"other":1}"#), None);
    }
}
