"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CaretUpDownIcon, CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { createSpace } from "@/app/actions/spaces";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const createSpaceSchema = z.object({
  name: z.string().trim().min(1, "Space name is required"),
});

type CreateSpaceValues = z.infer<typeof createSpaceSchema>;

interface SpaceInfo {
  id: string;
  name: string;
}

interface SpaceSwitcherProps {
  currentSpaceId: string;
  spaces: SpaceInfo[];
}

export function SpaceSwitcher({ spaces, currentSpaceId }: SpaceSwitcherProps) {
  const router = useRouter();
  const current = spaces.find((s) => s.id === currentSpaceId);
  const [sheetOpen, setSheetOpen] = useState(false);

  const form = useForm<CreateSpaceValues>({
    resolver: zodResolver(createSpaceSchema),
    defaultValues: { name: "" },
    mode: "onChange",
  });

  const { isValid, isSubmitting } = form.formState;

  async function handleSubmit(values: CreateSpaceValues) {
    try {
      const result = await createSpace(values.name);

      if ("error" in result) {
        form.setError("root", { message: result.error });
        return;
      }

      toast.success("Space created");
      setSheetOpen(false);
      window.location.assign(`/${result.data.id}`);
    } catch {
      form.setError("root", { message: "Failed to create space" });
    }
  }

  function handleOpenSheet() {
    form.reset({ name: "" });
    setSheetOpen(true);
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="w-full justify-between" variant="outline">
            <span className="truncate">
              {current ? current.name : "Select space"}
            </span>
            <CaretUpDownIcon className="size-4 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Spaces</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {spaces.map((space) => (
            <DropdownMenuItem
              key={space.id}
              onClick={() => router.push(`/${space.id}`)}
            >
              <span className="truncate">{space.name}</span>
              {space.id === currentSpaceId && (
                <CheckIcon className={cn("ml-auto size-4")} />
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleOpenSheet}>
            <PlusIcon className="size-4" />
            <span>Create new space</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Sheet onOpenChange={setSheetOpen} open={sheetOpen}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Create new space</SheetTitle>
            <SheetDescription>
              A space is a workspace for organizing your Cubes and team members.
            </SheetDescription>
          </SheetHeader>
          <Form {...form}>
            <form
              className="flex flex-col gap-4 p-4"
              onSubmit={form.handleSubmit(handleSubmit)}
            >
              {form.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {form.formState.errors.root.message}
                  </AlertDescription>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Space Name</FormLabel>
                    <FormControl>
                      <Input autoFocus placeholder="My Project" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                className="w-full"
                disabled={!isValid || isSubmitting}
                type="submit"
              >
                {isSubmitting && <Spinner className="size-4" />}
                Create Space
              </Button>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
    </>
  );
}
