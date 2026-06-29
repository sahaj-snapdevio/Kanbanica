"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { EnvelopeIcon, PaperPlaneTiltIcon, CheckCircleIcon, GoogleLogoIcon } from "@phosphor-icons/react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
});
type FormData = z.infer<typeof schema>;

function useLoginForm() {
  const [sent, setSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
    mode: "onChange",
  });

  const { isSubmitting, isValid } = form.formState;

  async function handleGoogleSignIn() {
    form.clearErrors("root");
    setGoogleLoading(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: "/post-auth" });
    } catch {
      form.setError("root", { message: "Failed to sign in with Google. Please try again." });
      setGoogleLoading(false);
    }
  }

  async function onSubmit({ email }: FormData) {
    const { error } = await authClient.signIn.magicLink({ email, callbackURL: "/post-auth" });
    if (error) {
      form.setError("root", { message: error.message ?? "Something went wrong" });
      return;
    }
    setSent(true);
    toast.success("Magic link sent!", { description: "Check your inbox to sign in." });
  }

  return { sent, setSent, googleLoading, form, isSubmitting, isValid, handleGoogleSignIn, onSubmit };
}

// ── Flat (inline) form — used inside the modal page layout ─────────────────────

export function LoginFormFlat() {
  const { sent, setSent, googleLoading, form, isSubmitting, isValid, handleGoogleSignIn, onSubmit } = useLoginForm();

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
          <CheckCircleIcon className="size-6 text-primary" weight="duotone" />
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Check your inbox</h2>
          <p className="text-sm leading-relaxed text-foreground/70">
            We sent a sign-in link to{" "}
            <span className="font-semibold text-foreground">{form.getValues("email")}</span>.
          </p>
        </div>
        <p className="text-muted-foreground text-xs">
          {"Didn't receive it? "}
          <button onClick={() => setSent(false)} className="underline underline-offset-4 hover:text-foreground transition-colors">
            Try again
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Google */}
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2 rounded-lg h-11 text-foreground border-input disabled:opacity-60"
        disabled={isSubmitting || googleLoading}
        onClick={handleGoogleSignIn}
      >
        {googleLoading ? <Spinner className="size-4" /> : <GoogleLogoIcon className="size-4" />}
        {googleLoading ? "Connecting…" : "Continue with Google"}
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-muted-foreground text-xs">or continue with email</span>
        <Separator className="flex-1" />
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-semibold text-foreground">Email address</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" placeholder="you@example.com" className="h-11 rounded-lg text-foreground font-medium" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {form.formState.errors.root && (
            <Alert variant="destructive">
              <AlertDescription>{form.formState.errors.root.message}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            disabled={!isValid || isSubmitting}
            className="w-full gap-2 h-11 rounded-lg text-sm font-semibold shadow-sm disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none"
          >
            {isSubmitting ? (
              <><Spinner className="size-4" />Sending…</>
            ) : (
              <><PaperPlaneTiltIcon className="size-4" />Send magic link</>
            )}
          </Button>
        </form>
      </Form>

      <p className="text-center text-muted-foreground text-xs pt-1">
        By signing in you agree to our{" "}
        <a href="/terms" className="underline underline-offset-4 hover:text-foreground transition-colors">Terms of Service</a>{" "}
        and{" "}
        <a href="/privacy" className="underline underline-offset-4 hover:text-foreground transition-colors">Privacy Policy</a>.
      </p>
    </div>
  );
}

// ── Card-wrapped form — used standalone if needed ──────────────────────────────

export function LoginForm() {
  const { sent, setSent, googleLoading, form, isSubmitting, isValid, handleGoogleSignIn, onSubmit } = useLoginForm();

  if (sent) {
    return (
      <Card className="rounded-xl">
        <CardContent className="flex flex-col items-center gap-4 pb-8 pt-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CheckCircleIcon className="size-6 text-primary" weight="duotone" />
          </div>
          <div className="space-y-1">
            <h2 className="font-semibold text-lg">Check your inbox</h2>
            <p className="text-muted-foreground text-sm">
              We sent a sign-in link to{" "}
              <span className="font-medium text-foreground">{form.getValues("email")}</span>.
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            {"Didn't receive it? "}
            <button onClick={() => setSent(false)} className="underline underline-offset-4 hover:text-foreground transition-colors">
              Try again
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl">
      <CardContent className="pt-6 space-y-4">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <EnvelopeIcon className="size-5 text-primary" weight="duotone" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Sign in</h2>
          <p className="text-muted-foreground text-sm mt-0.5">Enter your email and we'll send you a magic link.</p>
        </div>
        <Button type="button" variant="outline" className="w-full gap-2" disabled={isSubmitting || googleLoading} onClick={handleGoogleSignIn}>
          {googleLoading ? <Spinner className="size-4" /> : <GoogleLogoIcon className="size-4" />}
          Continue with Google
        </Button>
        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-muted-foreground text-xs">or continue with email</span>
          <Separator className="flex-1" />
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email address</FormLabel>
                <FormControl><Input type="email" autoComplete="email" placeholder="you@example.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            {form.formState.errors.root && (
              <Alert variant="destructive"><AlertDescription>{form.formState.errors.root.message}</AlertDescription></Alert>
            )}
            <Button type="submit" disabled={!isValid || isSubmitting} className="w-full gap-2">
              {isSubmitting ? <><Spinner className="size-4" />Sending…</> : <><PaperPlaneTiltIcon className="size-4" />Send magic link</>}
            </Button>
          </form>
        </Form>
        <p className="text-center text-muted-foreground text-xs pb-2">
          By signing in you agree to our{" "}
          <a href="/terms" className="underline underline-offset-4 hover:text-foreground transition-colors">Terms of Service</a>{" "}
          and{" "}
          <a href="/privacy" className="underline underline-offset-4 hover:text-foreground transition-colors">Privacy Policy</a>.
        </p>
      </CardContent>
    </Card>
  );
}

export { LoginForm as AuthForm };
