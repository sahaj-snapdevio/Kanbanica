"use client";

import * as React from "react";
import { useActionState } from "react";
import {
  type ActionState,
  deleteAccountAction,
  updateNameAction,
} from "@/app/actions/profile";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const initialState: ActionState = {};

function ActionMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="rounded-none bg-destructive/10 p-3 text-destructive text-sm">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="rounded-none bg-success-subtle p-3 text-success-foreground text-sm">
        {state.success}
      </p>
    );
  }
  return null;
}

function EmailChangeForm({ email, callbackURL }: { email: string; callbackURL: string }) {
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<{ type: "success" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const newEmail = (new FormData(e.currentTarget).get("email") as string ?? "").trim().toLowerCase();

    if (newEmail === email.toLowerCase()) {
      setMessage({ type: "error", text: "That's already your current email." });
      return;
    }

    setPending(true);
    setMessage(null);

    const { error } = await authClient.changeEmail({
      newEmail,
      callbackURL,
    });

    setPending(false);

    if (error) {
      setMessage({ type: "error", text: error.message ?? "Failed to send verification email." });
    } else {
      setMessage({ type: "success", text: `Verification email sent to ${newEmail}. Click the link to confirm your new address.` });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block" htmlFor="email">
        <span className="mb-2 block font-semibold text-foreground text-sm">
          New email
        </span>
        <Input
          defaultValue={email}
          id="email"
          name="email"
          required
          type="email"
        />
      </label>
      {message && (
        <p className={`rounded-md p-3 text-sm ${message.type === "error" ? "bg-destructive/10 text-destructive" : "bg-success-subtle text-success-foreground"}`}>
          {message.text}
        </p>
      )}
      <Button disabled={pending} type="submit">
        {pending ? "Sending…" : "Send verification email"}
      </Button>
    </form>
  );
}

export function AccountIdentityForms({
  email,
  name,
  callbackURL = "/dashboard/profile",
}: {
  email: string;
  name: string;
  callbackURL?: string;
}) {
  const [nameState, nameAction, namePending] = useActionState(
    updateNameAction,
    initialState
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Display Name</CardTitle>
          <CardDescription>
            The name shown in navigation, audit logs, and admin views.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={nameAction} className="space-y-4">
            <label className="block" htmlFor="name">
              <span className="mb-2 block font-semibold text-foreground text-sm">
                Name
              </span>
              <Input
                defaultValue={name}
                id="name"
                maxLength={100}
                name="name"
              />
            </label>
            <ActionMessage state={nameState} />
            <Button disabled={namePending} type="submit">
              {namePending ? "Saving..." : "Save name"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email Address</CardTitle>
          <CardDescription>
            A verification link is sent to the new address. Your old email
            stays active until you confirm.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmailChangeForm email={email} callbackURL={callbackURL} />
        </CardContent>
      </Card>
    </div>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(
    deleteAccountAction,
    initialState
  );

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Delete Account</CardTitle>
        <CardDescription>
          Permanently delete your user, sessions, and linked auth accounts.
          Audit records remain for operator history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <label className="block" htmlFor="confirmEmail">
            <span className="mb-2 block font-semibold text-foreground text-sm">
              Type your email to confirm
            </span>
            <Input
              autoComplete="off"
              id="confirmEmail"
              name="confirmEmail"
              placeholder={email}
            />
          </label>
          <ActionMessage state={state} />
          <Button disabled={pending} type="submit" variant="destructive">
            {pending ? "Deleting..." : "Delete my account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
