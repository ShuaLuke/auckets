// Apple touch icon — the logo mark (design/assets/logo-mark-greenwood.svg)
// redrawn full-bleed as a PNG via ImageResponse, since iOS requires a
// raster icon and applies its own corner mask (so no rounded corners or
// transparency here; transparent pixels would render black on a home
// screen). Static — rendered once at build time.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

const GREENWOOD = "#1F4A2E";
const PAPER = "#F4F1E8";

export default async function AppleIcon() {
  const bricolageBold = await readFile(
    join(process.cwd(), "src/app/_brand/BricolageGrotesque-Bold.ttf"),
  );

  // Geometry scaled from the 120-unit logo mark to 180px full-bleed:
  // the "A" sits low-left, the perforation dots run down the right.
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: GREENWOOD,
          fontFamily: "Bricolage Grotesque",
        }}
      >
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "flex-end",
            paddingLeft: 18,
            paddingBottom: 8,
          }}
        >
          <div
            style={{
              fontSize: 132,
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: PAPER,
            }}
          >
            A
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "16px 0",
            marginRight: 34,
            width: 6,
          }}
        >
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                backgroundColor: PAPER,
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Bricolage Grotesque",
          data: bricolageBold,
          weight: 700,
          style: "normal",
        },
      ],
    },
  );
}
