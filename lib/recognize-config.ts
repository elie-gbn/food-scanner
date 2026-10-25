/** Shared by the browser recognizer and the embedding build script. */
export const MODEL_ID = "Xenova/mobileclip_s1";

/** Prompt templates averaged into each food's text embedding. */
export const PROMPTS = ["a photo of {}, a type of food.", "a photo of {}.", "a close-up photo of {} on a table.", "a photo of a serving of {}."];

/** Non-food labels: when one of these wins, the photo probably doesn't show food. */
export const NOT_FOOD = ["a person", "a room", "a computer screen", "a phone", "a pet", "a car", "a book", "a hand", "a barcode", "a plant", "an empty plate", "a blank wall"];
