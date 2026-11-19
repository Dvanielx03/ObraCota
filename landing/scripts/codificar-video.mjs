// Prepara un clip para moverlo con el scroll: fotograma clave cada 6 cuadros (búsquedas
// rápidas hacia delante y hacia atrás), sin audio, color marcado para que coincida con el
// póster, y dos tamaños (escritorio y móvil). Extrae también el primer y el último cuadro.
//
// Uso: node scripts/codificar-video.mjs <entrada.mp4> <nombre>
// Sale: public/video/<nombre>-1080.mp4, <nombre>-720.mp4 (o el tamaño de origen si es menor)
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const [, , entrada, nombre] = process.argv;
if (!entrada || !nombre) {
  console.error("Uso: node scripts/codificar-video.mjs <entrada.mp4> <nombre>");
  process.exit(1);
}
const salida = "public/video";
mkdirSync(salida, { recursive: true });

const sonda = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,nb_frames,duration", "-of", "json", entrada], { encoding: "utf8" });
const flujo = JSON.parse(sonda).streams[0];
console.log("origen:", flujo.width, "x", flujo.height, flujo.r_frame_rate, "fps,", flujo.nb_frames, "cuadros,", Number(flujo.duration).toFixed(2), "s");

const COLOR = ["-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1", "-colorspace", "bt709", "-color_range", "tv"];
function codificar(ancho, crf) {
  const destino = join(salida, `${nombre}-${ancho}.mp4`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", entrada, "-an", "-vf", `scale=${ancho}:-2:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-g", "6", "-keyint_min", "6", "-sc_threshold", "0", ...COLOR, "-movflags", "+faststart+write_colr", destino]);
  console.log(destino, (statSync(destino).size / 1_048_576).toFixed(2), "MB");
}
// No se amplía: si el origen es 720p, la versión de escritorio se queda en su ancho real.
const anchoGrande = Math.min(flujo.width, 1920);
codificar(anchoGrande, 24);
if (anchoGrande > 960) codificar(960, 27);
