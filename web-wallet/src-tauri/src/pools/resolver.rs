//! DNS-SD resolver for pool discovery.

use std::collections::BTreeMap;

/// Parsed DNS-SD TXT record: `name` (required for usable entry) + extras.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedTxt {
    pub name: Option<String>,
    pub url: Option<String>,
    pub extras: BTreeMap<String, String>,
}

/// Parse a flat list of DNS-SD TXT character-strings into a `ParsedTxt`.
///
/// Strings without `=` are discarded (per RFC 6763 §6.4 we MAY accept them as
/// boolean flags; we don't use any so they're dropped). `name` and `url` are
/// promoted to dedicated fields; everything else lives in `extras`.
pub fn parse_txt(strings: &[String]) -> ParsedTxt {
    let mut out = ParsedTxt::default();
    for s in strings {
        let Some(eq) = s.find('=') else {
            continue;
        };
        let key = &s[..eq];
        let val = &s[eq + 1..];
        if key.is_empty() {
            continue; // RFC 6763 §6.4: keys must be at least one character.
        }
        match key {
            "name" if out.name.is_none() => out.name = Some(val.to_string()),
            "url" if out.url.is_none() => out.url = Some(val.to_string()),
            "name" | "url" => {} // first-wins; later duplicates ignored.
            _ => {
                out.extras.entry(key.to_string()).or_insert_with(|| val.to_string());
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_txt_extracts_name_and_extras() {
        let strings = vec![
            "name=Nogrod Mainnet".to_string(),
            "operator=Nogrod".to_string(),
        ];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Nogrod Mainnet"));
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some("Nogrod"));
    }

    #[test]
    fn parse_txt_ignores_strings_without_equals() {
        let strings = vec!["badformat".to_string(), "name=Foo".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Foo"));
        assert!(parsed.extras.is_empty());
    }

    #[test]
    fn parse_txt_promotes_url_field() {
        let strings = vec!["url=https://alt.example.com/api".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.url.as_deref(), Some("https://alt.example.com/api"));
    }

    #[test]
    fn parse_txt_handles_empty_value() {
        let strings = vec!["operator=".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some(""));
    }

    #[test]
    fn parse_txt_first_wins_for_duplicate_promoted_key() {
        let strings = vec!["name=First".to_string(), "name=Second".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("First"));
    }

    #[test]
    fn parse_txt_first_wins_for_duplicate_extras_key() {
        let strings = vec!["operator=First".to_string(), "operator=Second".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.extras.get("operator").map(String::as_str), Some("First"));
    }

    #[test]
    fn parse_txt_drops_empty_key() {
        let strings = vec!["=orphan".to_string(), "name=Foo".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.name.as_deref(), Some("Foo"));
        assert!(parsed.extras.is_empty());
    }

    #[test]
    fn parse_txt_keeps_equals_in_value() {
        let strings = vec!["url=https://x.example/api?a=b&c=d".to_string()];
        let parsed = parse_txt(&strings);
        assert_eq!(parsed.url.as_deref(), Some("https://x.example/api?a=b&c=d"));
    }
}
