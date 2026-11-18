import type { MetadataRoute } from "next";

/** Android の「ホーム画面に追加」。アイコンは src/app/icons/ の下（ビルド時に作る PNG） */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "agent-desk",
    short_name: "agent-desk",
    start_url: "/",
    display: "standalone",
    theme_color: "#4f46e5",
    background_color: "#4f46e5",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
