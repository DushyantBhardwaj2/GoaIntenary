import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
        <div style={{ width: 12, height: 12, borderRadius: 6, background: "#DE6C4E", display: "flex" }} />
        <div style={{ width: 22, height: 5, borderRadius: 5, background: "#E8D9B4", marginTop: 4, display: "flex" }} />
      </div>
    ),
    { ...size },
  );
}
