import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  xs: "size-5",
  sm: "size-6",
  md: "size-8",
  lg: "size-10",
};

const TEXT_CLASSES = {
  xs: "text-[9px]",
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-sm",
};

function getInitials(name?: string | null, email?: string | null): string {
  if (name?.trim()) {
    return name
      .trim()
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  return (email ?? "?").slice(0, 2).toUpperCase();
}

export function UserAvatar({ name, email, image, size = "md", className }: UserAvatarProps) {
  const avatarUrl = image ? `/api/files/${image}` : null;
  const initials = getInitials(name, email);

  return (
    <Avatar className={cn(SIZE_CLASSES[size], className)}>
      {avatarUrl && (
        <AvatarImage src={avatarUrl} alt={name ?? email ?? "User"} />
      )}
      <AvatarFallback className={TEXT_CLASSES[size]}>{initials}</AvatarFallback>
    </Avatar>
  );
}
