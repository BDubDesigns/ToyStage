export interface Scene {
  id: string;
  name: string;
  kind: "still" | "animated";
  thumbnail: string;
}

const asset = (name: string): string => `${import.meta.env.BASE_URL}scenes/${name}`;
export const SCENES: readonly Scene[] = [
  { id: "enchanted-forest", name: "Enchanted Forest", kind: "still", thumbnail: asset("enchanted-forest.webp") },
  { id: "lunar-outpost", name: "Lunar Outpost", kind: "still", thumbnail: asset("lunar-outpost.webp") },
  { id: "underwater-reef", name: "Underwater Reef", kind: "still", thumbnail: asset("underwater-reef.webp") },
  { id: "starry-toyroom", name: "Starry Toyroom", kind: "still", thumbnail: asset("starry-toyroom.webp") },
  { id: "cosmic-cruise", name: "Cosmic Cruise", kind: "animated", thumbnail: asset("cosmic-cruise.svg") },
];

// Bounded to the four built-in stills. Repeated selections share one decode;
// failures can retry. No camera data, local storage, or remote content involved.
export class SceneImages {
  private readonly images = new Map<string, Promise<HTMLImageElement>>();

  load(scene: Scene): Promise<HTMLImageElement | null> {
    if (scene.kind === "animated") return Promise.resolve(null);
    let pending = this.images.get(scene.id);
    if (!pending) {
      pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          image.onload = image.onerror = null;
          resolve(image);
        };
        image.onerror = () => {
          image.onload = image.onerror = null;
          this.images.delete(scene.id);
          reject(new Error(`Could not load ${scene.name}. Tap it to try again.`));
        };
        image.src = scene.thumbnail;
      });
      this.images.set(scene.id, pending);
    }
    return pending;
  }
}

// Centered cover: fill the stage, preserve proportions, crop the long axis.
export function getSceneUvScale(stageWidth: number, stageHeight: number, imageWidth: number, imageHeight: number): [number, number] {
  const ratio = (stageWidth / stageHeight) / (imageWidth / imageHeight);
  return ratio > 1 ? [1, 1 / ratio] : [ratio, 1];
}
