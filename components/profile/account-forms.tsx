"use client";

import { useActionState } from "react";
import {
  type ActionState,
  changeEmailAction,
  deleteAccountAction,
  updateNameAction,
} from "@/app/actions/profile";
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

export function AccountIdentityForms({
  email,
  name,
}: {
  email: string;
  name: string;
}) {
  const [nameState, nameAction, namePending] = useActionState(
    updateNameAction,
    initialState
  );
  const [emailState, emailAction, emailPending] = useActionState(
    changeEmailAction,
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
            Magic-link authentication uses this email as the account identity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={emailAction} className="space-y-4">
            <label className="block" htmlFor="email">
              <span className="mb-2 block font-semibold text-foreground text-sm">
                Email
              </span>
              <Input
                defaultValue={email}
                id="email"
                name="email"
                required
                type="email"
              />
            </label>
            <ActionMessage state={emailState} />
            <Button disabled={emailPending} type="submit">
              {emailPending ? "Saving..." : "Update email"}
            </Button>
          </form>
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
