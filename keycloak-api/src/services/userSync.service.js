import {
  createKeycloakUser,
  findUserByAuth0Id,
  findUsersByEmail,
  updateKeycloakUser,
} from "./keycloak.service.js";

function deriveUsername(email, name) {
  if (email && email.includes("@")) return email.split("@")[0];
  if (name) return name.toLowerCase().replace(/\s+/g, ".");
  return `user_${Date.now()}`;
}

export function normalizeAuth0User(profile) {
  return {
    auth0_id: profile.sub,
    email: (profile.email || "").toLowerCase(),
    name:
      profile.name ||
      [profile.given_name, profile.family_name].filter(Boolean).join(" ") ||
      profile.nickname ||
      "",
    email_verified: Boolean(profile.email_verified),
  };
}

export async function syncUserToKeycloak(profile) {
  const u = normalizeAuth0User(profile);
  if (!u.auth0_id || !u.email) {
    return { keycloakSync: "skipped", reason: "invalid_payload" };
  }

  const attributes = {
    auth0_id: [u.auth0_id],
    last_synced_at: [new Date().toISOString()],
  };
  if (profile.app_user_id) {
    attributes.app_user_id = [String(profile.app_user_id)];
  }

  try {
    let existing = await findUserByAuth0Id(u.auth0_id);
    if (!existing) {
      const byEmail = await findUsersByEmail(u.email);
      existing = byEmail[0] || null;
    }

    if (existing) {
      const next = {
        ...existing,
        email: u.email,
        firstName: u.name?.split(" ")[0] || existing.firstName,
        lastName: u.name?.split(" ").slice(1).join(" ") || existing.lastName,
        attributes: {
          ...(existing.attributes || {}),
          ...attributes,
        },
        emailVerified: u.email_verified,
      };
      await updateKeycloakUser(existing.id, next);
      return { keycloakSync: "ok" };
    }

    const username = deriveUsername(u.email, u.name);
    await createKeycloakUser({
      username,
      email: u.email,
      enabled: true,
      emailVerified: u.email_verified,
      firstName: u.name?.split(" ")[0] || "",
      lastName: u.name?.split(" ").slice(1).join(" ") || "",
      attributes,
    });
    return { keycloakSync: "ok" };
  } catch (e) {
    console.error("Keycloak sync error", e);
    return { keycloakSync: "failed", reason: e.message };
  }
}
