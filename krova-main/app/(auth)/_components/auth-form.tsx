"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { EnvelopeSimple, GoogleLogoIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { signIn, useSession } from "@/lib/auth-client";

const authSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

type AuthFormValues = z.infer<typeof authSchema>;

interface AuthFormProps {
  description: string;
  footerLinkHref: string;
  footerLinkText: string;
  footerText: string;
  googleButtonLabel: string;
  invitedEmail?: string | null;
  submitButtonLabel: string;
  title: string;
}

export function AuthForm({
  title,
  description,
  googleButtonLabel,
  submitButtonLabel,
  footerText,
  footerLinkText,
  footerLinkHref,
  invitedEmail,
}: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: isSessionPending } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const inviteToken = searchParams.get("invite");

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: { email: invitedEmail ?? "" },
    mode: "onChange",
  });

  useEffect(() => {
    if (session) {
      router.replace(inviteToken ? `/invite/${inviteToken}` : "/post-auth");
    }
  }, [session, router, inviteToken]);

  if (isSessionPending || session) {
    return null;
  }

  async function onSubmit(values: AuthFormValues) {
    setIsLoading(true);

    try {
      const result = await signIn.magicLink({
        email: values.email,
        callbackURL: inviteToken ? `/invite/${inviteToken}` : "/post-auth",
      });

      if (result.error) {
        form.setError("root", {
          message: result.error.message ?? "Failed to send magic link",
        });
        setIsLoading(false);
        return;
      }

      setMagicLinkSent(true);
      setIsLoading(false);
    } catch {
      form.setError("root", {
        message: "An unexpected error occurred. Please try again.",
      });
      setIsLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    form.clearErrors("root");
    setOauthLoading(true);

    try {
      await signIn.social({
        provider: "google",
        callbackURL: inviteToken ? `/invite/${inviteToken}` : "/post-auth",
      });
    } catch {
      form.setError("root", {
        message: "Failed to sign in with Google. Please try again.",
      });
      setOauthLoading(false);
    }
  }

  const isPending = isLoading || oauthLoading;

  if (magicLinkSent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Check your email</CardTitle>
          <CardDescription>Magic link sent</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="bg-secondary text-secondary-foreground">
            <AlertDescription className="text-secondary-foreground">
              We&apos;ve sent a sign-in link to{" "}
              <strong>{form.getValues("email")}</strong>. Click the link in the
              email to sign in.
            </AlertDescription>
          </Alert>
          <p className="text-center text-sm text-muted-foreground">
            If you don&apos;t see it, check your spam or junk folder.
          </p>
          <p className="text-center text-sm text-muted-foreground">
            Didn&apos;t receive it?{" "}
            <button
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => {
                setMagicLinkSent(false);
                setIsLoading(false);
              }}
              type="button"
            >
              Try again
            </button>
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {invitedEmail && (
          <Alert className="bg-secondary text-secondary-foreground">
            <AlertDescription className="text-secondary-foreground">
              This invite is for{" "}
              <strong className="break-all">{invitedEmail}</strong>. Continue
              with that email to join the team.
            </AlertDescription>
          </Alert>
        )}

        <Button
          className="w-full"
          disabled={isLoading || oauthLoading}
          onClick={handleGoogleSignIn}
          type="button"
          variant="outline"
        >
          {oauthLoading ? (
            <Spinner className="mr-2" />
          ) : (
            <GoogleLogoIcon className="mr-2 size-4" />
          )}
          {googleButtonLabel}
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator className="w-full" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="email"
                      disabled={isLoading || oauthLoading}
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

            <Button className="w-full" disabled={isPending} type="submit">
              {isLoading ? (
                <Spinner className="mr-2" />
              ) : (
                <EnvelopeSimple className="mr-2 size-4" />
              )}
              {submitButtonLabel}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-muted-foreground">
          {footerText}{" "}
          <a
            className="text-primary underline-offset-4 hover:underline"
            href={
              inviteToken
                ? `${footerLinkHref}?invite=${inviteToken}`
                : footerLinkHref
            }
          >
            {footerLinkText}
          </a>
        </p>

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/terms"
          >
            Terms of Service
          </Link>{" "}
          and acknowledge our{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
