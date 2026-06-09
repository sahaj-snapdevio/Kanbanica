/**
 * EmailIt contacts API — workspace-level marketing contacts.
 *
 * Endpoints — https://emailit.com/docs/api-reference/
 *   POST   /v2/contacts        create (the only place `audiences` can be set)
 *   GET    /v2/contacts/{id}   retrieve by con_xxx id OR email address
 *   POST   /v2/contacts/{id}   update (custom_fields REPLACE, not merge;
 *                              `audiences` cannot be changed here)
 *   DELETE /v2/contacts/{id}   permanently remove contact + audience memberships
 */

import { EmailitError, emailitRequest } from "@/lib/emailit/client";

export interface EmailitContact {
  audiences: unknown[];
  created_at: string;
  custom_fields: Record<string, unknown>;
  email: string;
  first_name: string | null;
  id: string;
  last_name: string | null;
  object: "contact";
  unsubscribed: boolean;
  updated_at: string;
}

export interface ContactCreateInput {
  /** Audience ids to join — only honored on create. */
  audiences: string[];
  customFields: Record<string, unknown>;
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed: boolean;
}

export interface ContactUpdateInput {
  customFields: Record<string, unknown>;
  firstName?: string;
  lastName?: string;
  unsubscribed: boolean;
}

/**
 * Retrieves a contact by con_xxx id or email address.
 * Returns null if the contact does not exist (404).
 */
export async function getEmailitContact(
  idOrEmail: string
): Promise<EmailitContact | null> {
  try {
    return await emailitRequest<EmailitContact>(
      `/contacts/${encodeURIComponent(idOrEmail)}`,
      { method: "GET" }
    );
  } catch (err) {
    if (err instanceof EmailitError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

/** Creates a contact and joins it to the given audiences. */
export async function createEmailitContact(
  input: ContactCreateInput
): Promise<EmailitContact> {
  return emailitRequest<EmailitContact>("/contacts", {
    method: "POST",
    body: {
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      custom_fields: input.customFields,
      unsubscribed: input.unsubscribed,
      audiences: input.audiences,
    },
  });
}

/** Updates an existing contact's profile fields (audience membership unchanged). */
export async function updateEmailitContact(
  idOrEmail: string,
  input: ContactUpdateInput
): Promise<EmailitContact> {
  return emailitRequest<EmailitContact>(
    `/contacts/${encodeURIComponent(idOrEmail)}`,
    {
      method: "POST",
      body: {
        first_name: input.firstName,
        last_name: input.lastName,
        custom_fields: input.customFields,
        unsubscribed: input.unsubscribed,
      },
    }
  );
}

/**
 * Permanently deletes a contact from EmailIt (and its audience memberships).
 * Returns `true` if the contact was deleted, `false` if it didn't exist (404)
 * — both are success states from the caller's perspective.
 */
export async function deleteEmailitContact(
  idOrEmail: string
): Promise<boolean> {
  try {
    await emailitRequest<unknown>(
      `/contacts/${encodeURIComponent(idOrEmail)}`,
      { method: "DELETE" }
    );
    return true;
  } catch (err) {
    if (err instanceof EmailitError && err.status === 404) {
      return false;
    }
    throw err;
  }
}
