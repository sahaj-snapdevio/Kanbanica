"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircleIcon,
  EnvelopeIcon,
  GoogleLogoIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";

const schema = z.object({
  email: z.string().email("Enter a valid email address"),
});
type FormData = z.infer<typeof schema>;

export function LoginForm() {
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
      await authClient.signIn.social({
        provider: "google",
        callbackURL: "/post-auth",
      });
    } catch {
      form.setError("root", {
        message: "Failed to sign in with Google. Please try again.",
      });
      setGoogleLoading(false);
    }
  }

  async function onSubmit({ email }: FormData) {
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: "/post-auth",
    });
    if (error) {
      form.setError("root", {
        message: error.message ?? "Something went wrong",
      });
      return;
    }
    setSent(true);
    toast.success("Magic link sent!", {
      description: "Check your inbox to sign in.",
    });
  }

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
              <span className="font-medium text-foreground">
                {form.getValues("email")}
              </span>
              .
            </p>
          </div>
          <p className="text-muted-foreground text-xs">
            {"Didn't receive it? "}
            <button
              className="underline underline-offset-4 transition-colors hover:text-foreground"
              onClick={() => setSent(false)}
            >
              Try again
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl">
      <CardHeader className="pb-4">
        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <EnvelopeIcon className="size-5 text-primary" weight="duotone" />
        </div>
        <CardTitle className="text-xl">Sign in</CardTitle>
        <CardDescription>
          Enter your email and we'll send you a magic link — no password needed.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Google OAuth */}
        <Button
          className="w-full gap-2"
          disabled={isSubmitting || googleLoading}
          onClick={handleGoogleSignIn}
          type="button"
          variant="outline"
        >
          {googleLoading ? (
            <Spinner className="size-4" />
          ) : (
            <GoogleLogoIcon className="size-4" />
          )}
          Continue with Google
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="flex-1" />
          <span className="text-muted-foreground text-xs">
            or continue with email
          </span>
          <Separator className="flex-1" />
        </div>

        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="email"
                      placeholder="you@example.com"
                      type="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <Alert variant="destructive">
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full gap-2"
              disabled={!isValid || isSubmitting}
              type="submit"
            >
              {isSubmitting ? (
                <>
                  <Spinner className="size-4" />
                  Sending…
                </>
              ) : (
                <>
                  <PaperPlaneTiltIcon className="size-4" />
                  Send magic link
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>

      <CardFooter className="flex-col gap-4 pt-0">
        <Separator />
        <p className="text-center text-muted-foreground text-xs">
          By signing in you agree to our{" "}
          <a
            className="underline underline-offset-4 transition-colors hover:text-foreground"
            href="/terms"
          >
            Terms of Service
          </a>{" "}
          and{" "}
          <a
            className="underline underline-offset-4 transition-colors hover:text-foreground"
            href="/privacy"
          >
            Privacy Policy
          </a>
          .
        </p>
      </CardFooter>
    </Card>
  );
}

export { LoginForm as AuthForm };
