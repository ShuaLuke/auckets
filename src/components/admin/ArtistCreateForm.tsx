// Admin Artists control — create an artist and optionally link its first
// member. Posts to POST /api/admin/artists (admin-gated, the authoritative
// check). Mirrors StaffRoleForm's conventions: local state, fetch, inline
// status banner, Card/Field/TextInput/Button primitives.
//
// The slug field prefills from the name as the operator types and stays
// editable; once they edit it by hand we stop auto-filling so we don't clobber
// their choice. On success we router.refresh() so the new artist appears in
// the roster above this form.

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { Field } from "@/components/ui/Field";
import { TextInput } from "@/components/ui/TextInput";
import { slugify } from "@/lib/slug";

type Banner = { kind: "ok" | "err"; text: string } | null;

export function ArtistCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [memberEmail, setMemberEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const canSubmit = name.trim() !== "" && !submitting;

  function onNameChange(value: string) {
    setName(value);
    // Keep the slug mirroring the name until the operator edits it by hand.
    if (!slugTouched) setSlug(slugify(value));
  }

  function onSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(value);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/admin/artists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          // Only send a slug if there's one to send; otherwise the server
          // derives it from the name.
          ...(slug.trim() !== "" ? { slug: slug.trim() } : {}),
          ...(memberEmail.trim() !== ""
            ? { memberEmail: memberEmail.trim() }
            : {}),
        }),
      });
      const body: {
        error?: string;
        artist?: { name?: string; slug?: string };
        member?: { email?: string; linked?: boolean; roleBumped?: boolean } | null;
      } = await res.json().catch(() => ({}));

      if (res.ok && body.artist) {
        const parts = [`Created ${body.artist.name} (/${body.artist.slug}).`];
        if (body.member?.email) {
          parts.push(
            body.member.linked
              ? `Linked ${body.member.email}${body.member.roleBumped ? " and made them an artist" : ""}.`
              : `${body.member.email} was already a member.`,
          );
        }
        setBanner({ kind: "ok", text: parts.join(" ") });
        // Reset for the next entry and refresh the roster above.
        setName("");
        setSlug("");
        setSlugTouched(false);
        setMemberEmail("");
        router.refresh();
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
      <Eyebrow className="mb-3.5">Add an artist</Eyebrow>
      <p
        className="mb-4 font-sans text-[13px]"
        style={{ color: "var(--fg-muted)", lineHeight: 1.5 }}
      >
        Create an artist and, optionally, link its first manager by the email
        they signed up with. They must have signed in to AUCKETS at least once
        to be linked — leave it blank to add them later.
      </p>

      <Field label="Artist name" htmlFor="artistName">
        <TextInput
          id="artistName"
          placeholder="Citizen Cope"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </Field>

      <div className="mt-4">
        <Field label="Slug" htmlFor="artistSlug">
          <TextInput
            id="artistSlug"
            placeholder="citizen-cope"
            value={slug}
            onChange={(e) => onSlugChange(e.target.value)}
          />
        </Field>
        <p
          className="mt-1.5 font-sans text-[12px]"
          style={{ color: "var(--fg-muted)" }}
        >
          Lowercase letters, numbers, and hyphens. Must be unique.
        </p>
      </div>

      <div className="mt-4">
        <Field label="Member email (optional)" htmlFor="artistMemberEmail">
          <TextInput
            id="artistMemberEmail"
            type="email"
            inputMode="email"
            placeholder="person@example.com"
            value={memberEmail}
            onChange={(e) => setMemberEmail(e.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="brand"
          disabled={!canSubmit}
          onClick={submit}
        >
          {submitting ? "Creating…" : "Create artist"}
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
