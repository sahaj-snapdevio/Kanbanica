"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { signOut } from "@/lib/auth-client";

interface MismatchActionsProps {
  token: string;
}

export function MismatchActions({ token }: MismatchActionsProps) {
  const [isLoading, setIsLoading] = useState(false);

  function handleSwitchAccount() {
    setIsLoading(true);
    signOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = `/login?invite=${token}`;
        },
        onError: () => {
          setIsLoading(false);
        },
      },
    });
  }

  return (
    <Button
      className="w-full"
      disabled={isLoading}
      onClick={handleSwitchAccount}
    >
      {isLoading ? <Spinner className="mr-2" /> : null}
      Sign out and switch account
    </Button>
  );
}
