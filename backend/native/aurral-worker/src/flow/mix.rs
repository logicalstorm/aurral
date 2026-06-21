use serde_json::Value;

#[derive(Debug, Clone, Copy, Default)]
pub struct FlowMix {
    pub discover: i64,
    pub mix: i64,
    pub trending: i64,
    pub focus: i64,
}

impl FlowMix {
    pub fn from_value(value: &Value) -> Self {
        let parse = |key: &str| -> i64 {
            value
                .get(key)
                .and_then(|entry| entry.as_i64().or_else(|| entry.as_f64().map(|n| n as i64)))
                .unwrap_or(0)
                .max(0)
        };
        Self {
            discover: parse("discover"),
            mix: parse("mix"),
            trending: parse("trending"),
            focus: parse("focus"),
        }
    }

    pub fn default_blend() -> Self {
        Self {
            discover: 34,
            mix: 33,
            trending: 33,
            focus: 0,
        }
    }
}
