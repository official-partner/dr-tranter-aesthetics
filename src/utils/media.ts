import { img, type Picture } from "./content";

/** A picture as the site's components take it: a collection's picture (committed or in OP's storage) or a file of
 *  public/ (« /img/hero.jpg »). Gives <Img>'s src, width and height: `<Img {...pic(image)} alt="…" />`. */
export type Pic = Picture | string;
export function pic(p: Pic): { src: ImageMetadata | string; width?: number; height?: number } {
  return typeof p === "string" ? { src: p } : img(p);
}
