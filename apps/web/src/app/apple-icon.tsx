import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#173F35",
        }}
      >
        <div style={{ width: 64, height: 64, borderRadius: 32, background: "#DE6C4E", display: "flex" }} />
        <div style={{ width: 120, height: 22, borderRadius: 22, background: "#E8D9B4", marginTop: 18, display: "flex" }} />
      </div>
    ),
    { ...size },
  );
}
