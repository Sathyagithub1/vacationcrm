/**
 * Theme service: Generate a full color palette from primary + secondary hex colors.
 * Returns CSS variable names and values for injection into :root.
 */

export interface ThemePreset {
  name: string;
  primary: string;
  secondary: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: "Sunset Orange", primary: "#FF6B35", secondary: "#FF9F1C" },
  { name: "Royal Indigo", primary: "#6C63FF", secondary: "#3F51B5" },
  { name: "Ocean Blue", primary: "#00B4D8", secondary: "#0077B6" },
  { name: "Tropical Green", primary: "#00C853", secondary: "#00BFA5" },
  { name: "Ruby Red", primary: "#E91E63", secondary: "#FF5252" },
  { name: "Slate", primary: "#475569", secondary: "#334155" },
];

/**
 * Parse hex color to RGB components.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16),
  };
}

/**
 * Convert RGB to hex string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Mix a color with white (lighten) or black (darken).
 * factor: 0 = original, 1 = fully white/black
 */
function mixColor(
  hex: string,
  mixWith: "white" | "black",
  factor: number
): string {
  const { r, g, b } = hexToRgb(hex);
  const target = mixWith === "white" ? 255 : 0;
  return rgbToHex(
    r + (target - r) * factor,
    g + (target - g) * factor,
    b + (target - b) * factor
  );
}

/**
 * Generate a full shade palette (50 through 900) from a base hex color.
 */
function generatePalette(baseHex: string): Record<string, string> {
  return {
    "50": mixColor(baseHex, "white", 0.92),
    "100": mixColor(baseHex, "white", 0.80),
    "200": mixColor(baseHex, "white", 0.60),
    "300": mixColor(baseHex, "white", 0.40),
    "400": mixColor(baseHex, "white", 0.20),
    "500": baseHex,
    "600": mixColor(baseHex, "black", 0.15),
    "700": mixColor(baseHex, "black", 0.30),
    "800": mixColor(baseHex, "black", 0.45),
    "900": mixColor(baseHex, "black", 0.60),
  };
}

export interface ThemeVariables {
  [key: string]: string;
}

/**
 * Generate full CSS variables from primary + secondary colors.
 * Returns an object of { "--var-name": "value" } entries.
 */
export function generateThemeVariables(
  primaryHex: string,
  secondaryHex: string
): ThemeVariables {
  const primary = generatePalette(primaryHex);
  const secondary = generatePalette(secondaryHex);

  const vars: ThemeVariables = {};

  // Primary palette
  for (const [shade, value] of Object.entries(primary)) {
    vars[`--color-primary-${shade}`] = value;
  }

  // Secondary palette
  for (const [shade, value] of Object.entries(secondary)) {
    vars[`--color-secondary-${shade}`] = value;
  }

  // Convenience aliases
  vars["--tenant-primary"] = primaryHex;
  vars["--tenant-primary-light"] = primary["50"];
  vars["--tenant-secondary"] = secondaryHex;

  return vars;
}

/**
 * Build a themeConfig JSON object suitable for storing in Tenant.themeConfig.
 */
export function buildThemeConfig(
  primaryColor: string,
  secondaryColor: string,
  presetName?: string
) {
  return {
    primaryColor,
    secondaryColor,
    presetName: presetName || "Custom",
    variables: generateThemeVariables(primaryColor, secondaryColor),
  };
}
