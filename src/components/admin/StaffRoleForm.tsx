// Admin Staff control — grant or revoke the VENUE_STAFF role by email.
// Posts to POST /api/admin/staff (admin-gated, the authoritative check).
// Mirrors the app's client-form conventions (local state, fetch, inline
// status banner).

"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { TextInput } from "@/components/ui/TextInput";

type Banner = { kind: "ok" | "err"; text: string } | null;

export function StaffRoleForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const canSubmit = email.trim() !== "" && !submitting;

  async function submit(role: "VENUE_STAFF" | "FAN") {
    if (!canSubmit) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body: { error?: string; email?: string; role?: string } = await res
        .json()
        .catch(() => ({}));
      if (res.ok) {
        setBanner({
          kind: "ok",
          text:
            role === "VENUE_STAFF"
              ? `${body.email} can now work the door (VENUE_STAFF).`
              : `${body.email} is back to a regular fan (FAN).`,
        });
      } else {
        setBanner({
          kind: "err",
          text: body.error ?? `Failed (HTTP ${res.status})`,
        });
      }
    } catch (err) {
      setBanner({
        kind: "err",
        text: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card style={{ padding: 24, maxWidth: 520 }}>
      <Eyebrow className="mb-3.5">Venue staff</Eyebrow>
      <p
        className="mb-4 font-sans text-[13px]"
        style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}
      >
        Grant a person the door-scanner role by the email they signed up with.
        They must have signed in to AUCKETS at least once.
      </p>

      <Field label="Email" htmlFor="staffEmail">
        <TextInput
          id="staffEmail"
          type="email"
          inputMode="email"
          placeholder="person@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="brand"
          disabled={!canSubmit}
          onClick={() => submit("VENUE_STAFF")}
        >
          {submitting ? "Saving…" : "Grant venue staff"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={!canSubmit}
          onClick={() => submit("FAN")}
        >
          Revoke
        </Button>
      </div>

      {banner && (
        <div
          className="mt-4 rounded-lg px-3.5 py-3 font-sans text-[13px]"
          style={
            banner.kind === "ok"
              ? { background: "var(--greenwood-50)", color: "var(--greenwood-700)" }
              : { background: "var(--brick-100)", color: "var(--brick-700)" }
          }
        >
          {banner.text}
        </div>
      )}
    </Card>
  );
}
