"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  changeEmailAction,
  updateMarketingOptInAction,
  updateNameAction,
} from "@/app/actions/profile";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

const nameSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be under 100 characters"),
});

const emailSchema = z.object({
  newEmail: z.string().email("Enter a valid email address"),
});

type NameFormValues = z.infer<typeof nameSchema>;
type EmailFormValues = z.infer<typeof emailSchema>;

interface ProfileFormProps {
  user: {
    id: string;
    name: string;
    email: string;
    marketingOptIn: boolean;
  };
}

export function ProfileForm({ user }: ProfileFormProps) {
  const router = useRouter();

  // Name form
  const [isNamePending, startNameTransition] = useTransition();
  const nameForm = useForm<NameFormValues>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: user.name },
    mode: "onChange",
  });

  // Email form
  const [isEmailPending, startEmailTransition] = useTransition();
  const [emailSent, setEmailSent] = useState(false);
  const emailForm = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { newEmail: "" },
    mode: "onChange",
  });

  // Marketing email preference
  const [isMarketingPending, startMarketingTransition] = useTransition();
  const [marketingOptIn, setMarketingOptIn] = useState(user.marketingOptIn);

  function handleToggleMarketing(checked: boolean) {
    setMarketingOptIn(checked);
    startMarketingTransition(async () => {
      const result = await updateMarketingOptInAction(checked);
      if ("error" in result) {
        setMarketingOptIn(!checked); // revert on failure
        toast.error(result.error);
        return;
      }
      toast.success(
        checked
          ? "Subscribed to product news & marketing emails"
          : "Unsubscribed from marketing emails"
      );
    });
  }

  function handleUpdateName(values: NameFormValues) {
    startNameTransition(async () => {
      const result = await updateNameAction(values.name);
      if ("error" in result) {
        nameForm.setError("root", { message: result.error });
        return;
      }
      toast.success("Name updated");
      nameForm.reset({ name: values.name });
      router.refresh();
    });
  }

  function handleChangeEmail(values: EmailFormValues) {
    startEmailTransition(async () => {
      const result = await changeEmailAction(values.newEmail);
      if ("error" in result) {
        emailForm.setError("root", { message: result.error });
        return;
      }
      setEmailSent(true);
      toast.success(
        "Verification email sent — check your inbox to confirm the change"
      );
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Name */}
      <Card>
        <CardHeader>
          <CardTitle>Display Name</CardTitle>
          <CardDescription>
            Update the name shown across your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...nameForm}>
            <form
              className="space-y-4"
              onSubmit={nameForm.handleSubmit(handleUpdateName)}
            >
              <FormField
                control={nameForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        disabled={isNamePending}
                        maxLength={100}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {nameForm.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {nameForm.formState.errors.root.message}
                  </AlertDescription>
                </Alert>
              )}

              <Button
                disabled={
                  !nameForm.formState.isValid ||
                  !nameForm.formState.isDirty ||
                  isNamePending
                }
                type="submit"
              >
                {isNamePending && <Spinner className="size-4" />}
                Save name
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle>Email Address</CardTitle>
          <CardDescription>
            Your current email is <strong>{user.email}</strong>. Changing it
            will send a verification link to the new address. The change takes
            effect after you click the link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {emailSent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                A verification link was sent to{" "}
                <strong>{emailForm.getValues("newEmail")}</strong>. Click the
                link in the email to confirm your new address.
              </p>
              <Button
                onClick={() => {
                  setEmailSent(false);
                  emailForm.reset({ newEmail: "" });
                }}
                size="sm"
                variant="outline"
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <Form {...emailForm}>
              <form
                className="space-y-4"
                onSubmit={emailForm.handleSubmit(handleChangeEmail)}
              >
                <FormField
                  control={emailForm.control}
                  name="newEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New email address</FormLabel>
                      <FormControl>
                        <Input
                          disabled={isEmailPending}
                          placeholder="you@example.com"
                          type="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {emailForm.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {emailForm.formState.errors.root.message}
                    </AlertDescription>
                  </Alert>
                )}

                <Button
                  disabled={!emailForm.formState.isValid || isEmailPending}
                  type="submit"
                >
                  {isEmailPending && <Spinner className="size-4" />}
                  Send verification
                </Button>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>

      {/* Email preferences */}
      <Card>
        <CardHeader>
          <CardTitle>Email Preferences</CardTitle>
          <CardDescription>
            Choose which non-essential emails you receive. Account and security
            emails are always sent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                Product news &amp; marketing
              </p>
              <p className="text-sm text-muted-foreground">
                Updates, tips, and announcements about Krova.
              </p>
            </div>
            <Switch
              aria-label="Product news and marketing emails"
              checked={marketingOptIn}
              disabled={isMarketingPending}
              onCheckedChange={handleToggleMarketing}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
