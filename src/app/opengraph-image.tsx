// Default OG / social card for every page that doesn't ship its own.
// Static — rendered once at build time. Per-show dynamic cards are a
// later slice.
//
// Brand notes: ink-900 stage-dark background, the wordmark in the
// Bricolage display face, marquee-amber tagline, and the ticket-stub
// perforation motif (a column of paper dots tearing off a darker stub
// on the right). Color literals mirror src/app/design-system.css —
// ImageResponse renders outside the DOM, so CSS custom properties
// aren't available here.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

export const alt = "AUCKETS — Front row, fair price";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK_900 = "#0E0F0C";
const INK_800 = "#131210";
const PAPER = "#F4F1E8";
const MARQUEE = "#C99A4B";
const GREENWOOD_300 = "#6A8F6F";

export default async function OpengraphImage() {
  // Static instance (wght 700, opsz 48) committed in src/app/_brand/ so
  // the build never depends on a fonts CDN.
  const bricolageBold = await readFile(
    join(process.cwd(), "src/app/_brand/BricolageGrotesque-Bold.ttf"),
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: INK_900,
          fontFamily: "Bricolage Grotesque",
        }}
      >
        {/* Main panel */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 88px",
          }}
        >
          <div
            style={{
              fontSize: 30,
              fontWeight: 700,
              color: GREENWOOD_300,
              letterSpacing: "0.16em",
              marginBottom: 28,
            }}
          >
            LIVE MUSIC, SEATED FAIRLY
          </div>
          <div
            style={{
              fontSize: 148,
              fontWeight: 700,
              color: PAPER,
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            AUCKETS
          </div>
          <div
            style={{
              fontSize: 52,
              fontWeight: 700,
              color: MARQUEE,
              letterSpacing: "-0.015em",
              marginTop: 30,
            }}
          >
            Front row, fair price.
          </div>
        </div>

        {/* Perforation — the ticket-stub tear line */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "26px 0",
            width: 10,
          }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                backgroundColor: PAPER,
                opacity: 0.55,
              }}
            />
          ))}
        </div>

        {/* Stub */}
        <div
          style={{
            width: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: INK_800,
          }}
        >
          <div
            style={{
              fontSize: 120,
              fontWeight: 700,
              color: MARQUEE,
              letterSpacing: "-0.04em",
              transform: "rotate(-90deg)",
            }}
          >
            A
          </div>
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
