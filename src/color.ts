export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface HsvColor {
  hue: number;
  saturation: number;
  brightness: number;
}

export function hsvToRgb(hue: number, saturation: number, brightness: number): RgbColor {
  const hNorm = hue > 0 ? hue / 360 : 0;
  const sNorm = saturation > 0 ? saturation / 100 : 1;
  const vNorm = brightness / 100;

  const c = vNorm * sNorm;
  const x = c * (1 - Math.abs(((hNorm * 6) % 2) - 1));
  const m = vNorm - c;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;
  const hSector = hNorm * 6;

  if (hSector < 1) {
    rPrime = c;
    gPrime = x;
  } else if (hSector < 2) {
    rPrime = x;
    gPrime = c;
  } else if (hSector < 3) {
    gPrime = c;
    bPrime = x;
  } else if (hSector < 4) {
    gPrime = x;
    bPrime = c;
  } else if (hSector < 5) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

export function rgbToHsv(red: number, green: number, blue: number): HsvColor {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }

  const saturation = max === 0 ? 0 : (delta / max) * 100;
  const brightness = max * 100;

  return {
    hue: Math.round(hue),
    saturation: Math.round(saturation),
    brightness: Math.round(brightness),
  };
}

export function rgbToHomeKitHueSaturation(red: number, green: number, blue: number): { hue: number; saturation: number } {
  const hsv = rgbToHsv(red, green, blue);
  return {
    hue: hsv.hue,
    saturation: hsv.saturation,
  };
}

export function homeKitHueSaturationBrightnessToApi(hue: number, saturation: number, brightness: number): HsvColor {
  const rgb = hsvToRgb(hue, saturation, brightness);
  const apiHsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  return {
    hue: apiHsv.hue,
    saturation: apiHsv.saturation,
    brightness: apiHsv.brightness,
  };
}

export function apiHsvToHomeKit(hue: number, saturation: number, brightness: number): {
  hue: number;
  saturation: number;
  brightness: number;
} {
  const rgb = hsvToRgb(hue, saturation, brightness);
  const hk = rgbToHomeKitHueSaturation(rgb.r, rgb.g, rgb.b);
  return {
    hue: hk.hue,
    saturation: hk.saturation,
    brightness,
  };
}
