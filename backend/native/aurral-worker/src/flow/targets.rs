use crate::flow::mix::FlowMix;
use std::collections::HashMap;

pub fn build_source_targets(size: usize, mix: FlowMix) -> HashMap<&'static str, usize> {
    let weights = [
        ("discover", mix.discover),
        ("mix", mix.mix),
        ("trending", mix.trending),
        ("focus", mix.focus),
    ];
    let sum: i64 = weights.iter().map(|(_, value)| *value).sum();
    if sum <= 0 {
        return HashMap::from([
            ("discover", 0),
            ("mix", 0),
            ("trending", 0),
            ("focus", 0),
        ]);
    }
    let scaled: Vec<(&str, f64)> = weights
        .iter()
        .map(|(key, value)| (*key, (*value as f64 / sum as f64) * size as f64))
        .collect();
    let floored: Vec<(&str, usize, f64)> = scaled
        .iter()
        .map(|(key, raw)| (*key, raw.floor() as usize, raw - raw.floor()))
        .collect();
    let mut remaining =
        size as i64 - floored.iter().map(|(_, count, _)| *count as i64).sum::<i64>();
    let mut ordered = floored;
    ordered.sort_by(|left, right| right.2.partial_cmp(&left.2).unwrap_or(std::cmp::Ordering::Equal));
    for item in ordered.iter_mut() {
        if remaining <= 0 {
            break;
        }
        item.1 += 1;
        remaining -= 1;
    }
    ordered
        .iter()
        .map(|(key, count, _)| (*key, *count))
        .collect()
}

pub fn harvest_limit_for(count: usize) -> usize {
    count.saturating_mul(3).max(16).min(72)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_source_targets_matches_weighted_split() {
        let mix = FlowMix {
            discover: 100,
            mix: 0,
            trending: 0,
            focus: 0,
        };
        let targets = build_source_targets(30, mix);
        assert_eq!(targets.get("discover").copied().unwrap_or(0), 30);
    }
}
