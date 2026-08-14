/** Browser entry for the dev harness. Exposes the renderer without any Obsidian imports. */
export { renderCard } from "../src/render/canvas";
export { palettesFromCover, paletteFromColor, contrastRatio } from "../src/color/palette";
export { STYLES, STYLE_LABELS, LIGHT_PALETTE, DARK_PALETTE } from "../src/render/styles";
export { RATIOS } from "../src/types";
