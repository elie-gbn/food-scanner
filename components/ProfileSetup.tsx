"use client";

import { useState } from "react";
import { ALLERGENS } from "@/lib/diet";
import { isEmptyProfile } from "@/lib/profile";
import { LANGUAGES } from "@/lib/translate";
import type { Profile } from "@/lib/verdict";

const DIET_CHOICES = [
  { id: "pork-free", label: "No pork", hint: "pork, bacon, lard" },
  { id: "halal", label: "Halal", hint: "no pork or alcohol" },
  { id: "vegetarian", label: "Vegetarian", hint: "no meat, fish or gelatin" },
  { id: "vegan", label: "Vegan", hint: "no animal products" },
];

const toggle = (list: string[], item: string) => list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];

export function ProfileSetup({ profile, onChange }: { profile: Profile; onChange: (next: Profile) => void }) {
  const empty = isEmptyProfile(profile);
  // Open for first-time visitors; after that the person opens it on purpose.
  const [open, setOpen] = useState<boolean | null>(null);
  const [word, setWord] = useState("");
  const isOpen = open ?? empty;
  const count = profile.allergens.length + profile.diets.length + profile.custom.length;

  const addWord = () => {
    if (!word.trim()) return;
    onChange({ ...profile, custom: [...profile.custom, word.trim()] });
    setWord("");
  };

  return (
    <details className="tapp-panel food-profile" open={isOpen} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <h2 style={{ display: "inline", margin: 0 }}>What can&apos;t you eat?</h2>
        <span className="tapp-small tapp-muted">{count > 0 ? ` ${count} chosen` : " Choose before you scan"}</span>
      </summary>

      <fieldset className="food-group">
        <legend className="tapp-label">Diet</legend>
        <div className="food-allergens">
          {DIET_CHOICES.map((diet) => (
            <label key={diet.id} className="food-chip tapp-small">
              <input type="checkbox" checked={profile.diets.includes(diet.id)} onChange={() => onChange({ ...profile, diets: toggle(profile.diets, diet.id) })} />
              <span>{diet.label} <span className="tapp-muted">({diet.hint})</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="food-group">
        <legend className="tapp-label">Allergies</legend>
        <div className="food-allergens">
          {ALLERGENS.map((name) => (
            <label key={name} className="food-chip tapp-small">
              <input type="checkbox" checked={profile.allergens.includes(name)} onChange={() => onChange({ ...profile, allergens: toggle(profile.allergens, name) })} />{name}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="food-group">
        <label className="tapp-label" htmlFor="custom-word">Other words to avoid</label>
        <form className="tapp-row" onSubmit={(event) => { event.preventDefault(); addWord(); }}>
          <input id="custom-word" className="tapp-input" style={{ flex: "1 1 12rem" }} value={word} maxLength={40} onChange={(event) => setWord(event.target.value)} placeholder="For example: alcohol, shellfish" autoComplete="off" />
          <button className="tapp-btn" type="submit" disabled={!word.trim() || profile.custom.length >= 20}>Add</button>
        </form>
        {profile.custom.length > 0 && (
          <div className="food-allergens">
            {profile.custom.map((entry) => (
              <button key={entry} type="button" className="food-chip tapp-small" aria-label={`Remove ${entry}`} onClick={() => onChange({ ...profile, custom: profile.custom.filter((item) => item !== entry) })}>{entry} ✕</button>
            ))}
          </div>
        )}
      </div>
      <div className="food-group">
        <label className="tapp-label" htmlFor="read-language">Translate ingredient lists to</label>
        <select id="read-language" className="tapp-input" style={{ maxWidth: "16rem" }} value={profile.language} onChange={(event) => onChange({ ...profile, language: event.target.value })}>
          {LANGUAGES.map((entry) => <option key={entry.code} value={entry.code}>{entry.name}</option>)}
        </select>
      </div>
      <p className="tapp-small tapp-muted" style={{ margin: ".75rem 0 0" }}>Saved on this device only. It is never sent anywhere.</p>
    </details>
  );
}
