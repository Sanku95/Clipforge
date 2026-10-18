use serde::{Deserialize, Serialize};

/// Output framing presets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Preset {
    /// Keep the source framing and size.
    Original,
    /// 9:16, 1080x1920 (Shorts / Reels / TikTok).
    Vertical,
    /// 1:1, 1080x1080.
    Square,
    /// 16:9, 1920x1080.
    Landscape,
}

impl Preset {
    pub fn label(self) -> &'static str {
        match self {
            Preset::Original => "original",
            Preset::Vertical => "9x16",
            Preset::Square => "1x1",
            Preset::Landscape => "16x9",
        }
    }

    /// Output size for a given source size.
    pub fn target_size(self, src_w: u32, src_h: u32) -> (u32, u32) {
        match self {
            Preset::Original => (even_floor(src_w).max(2), even_floor(src_h).max(2)),
            Preset::Vertical => (1080, 1920),
            Preset::Square => (1080, 1080),
            Preset::Landscape => (1920, 1080),
        }
    }
}

/// A crop rectangle in source pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CropRect {
    pub w: u32,
    pub h: u32,
    pub x: u32,
    pub y: u32,
}

pub fn even_floor(v: u32) -> u32 {
    v - (v % 2)
}

/// Largest rectangle with the target aspect ratio that fits in the source.
/// `pan` (0.0..=1.0) positions the crop along the axis that has spare room:
/// 0.5 is a centered crop. All values are even, as H.264 requires.
pub fn crop_rect(src_w: u32, src_h: u32, target_w: u32, target_h: u32, pan: f64) -> CropRect {
    let pan = if pan.is_finite() { pan.clamp(0.0, 1.0) } else { 0.5 };
    // Compare src_w/src_h with target_w/target_h without floating point.
    let src_wider = (src_w as u64) * (target_h as u64) > (src_h as u64) * (target_w as u64);
    let (w, h) = if src_wider {
        let w = ((src_h as u64 * target_w as u64) / target_h as u64) as u32;
        (even_floor(w).clamp(2, even_floor(src_w).max(2)), even_floor(src_h).max(2))
    } else {
        let h = ((src_w as u64 * target_h as u64) / target_w as u64) as u32;
        (even_floor(src_w).max(2), even_floor(h).clamp(2, even_floor(src_h).max(2)))
    };
    let x = even_floor(((src_w.saturating_sub(w)) as f64 * pan).round() as u32);
    let y = even_floor(((src_h.saturating_sub(h)) as f64 * pan).round() as u32);
    CropRect { w, h, x, y }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vertical_from_landscape_is_centered_9x16() {
        let r = crop_rect(1920, 1080, 1080, 1920, 0.5);
        assert_eq!((r.w, r.h), (606, 1080));
        assert_eq!(r.y, 0);
        assert_eq!(r.x, 656);
    }

    #[test]
    fn pan_moves_crop_but_stays_inside_source() {
        let left = crop_rect(1920, 1080, 1080, 1920, 0.0);
        let right = crop_rect(1920, 1080, 1080, 1920, 1.0);
        assert_eq!(left.x, 0);
        assert!(right.x + right.w <= 1920);
        assert_eq!(right.x, 1314);
    }

    #[test]
    fn square_from_landscape() {
        let r = crop_rect(1920, 1080, 1080, 1080, 0.5);
        assert_eq!((r.w, r.h, r.x, r.y), (1080, 1080, 420, 0));
    }

    #[test]
    fn landscape_from_vertical_crops_height() {
        let r = crop_rect(1080, 1920, 1920, 1080, 0.5);
        assert_eq!((r.w, r.h), (1080, 606));
        assert_eq!(r.x, 0);
        assert!(r.y + r.h <= 1920);
    }

    #[test]
    fn all_values_are_even_for_odd_sources() {
        let r = crop_rect(1279, 719, 1080, 1920, 0.37);
        assert!(r.w % 2 == 0 && r.h % 2 == 0 && r.x % 2 == 0 && r.y % 2 == 0);
        assert!(r.x + r.w <= 1279 && r.y + r.h <= 719);
    }

    #[test]
    fn nan_pan_falls_back_to_center() {
        let a = crop_rect(1920, 1080, 1080, 1920, f64::NAN);
        let b = crop_rect(1920, 1080, 1080, 1920, 0.5);
        assert_eq!(a, b);
    }

    #[test]
    fn original_keeps_even_size() {
        assert_eq!(Preset::Original.target_size(1279, 719), (1278, 718));
    }
}
