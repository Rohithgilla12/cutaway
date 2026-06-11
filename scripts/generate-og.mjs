import sharp from "sharp";

await sharp("assets/og.svg").png().toFile("public/og.png");
console.log("wrote public/og.png");
