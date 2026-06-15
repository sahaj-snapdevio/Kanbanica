export function workspaceInviteEmail({
  workspaceName,
  inviterName,
  url,
}: {
  workspaceName: string;
  inviterName: string;
  url: string;
}) {
  return {
    subject: `${inviterName} invited you to join ${workspaceName} on Kanbanica`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">Kanbanica</h2>
  <p><strong>${inviterName}</strong> invited you to join the workspace <strong>${workspaceName}</strong>.</p>
  <p>Click the button below to accept. The invite expires in 7 days.</p>
  <a href="${url}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Join ${workspaceName}</a>
  <p style="margin-top:24px;color:#666;font-size:13px;">
    Or copy this URL into your browser:<br>
    <a href="${url}" style="color:#666;word-break:break-all;">${url}</a>
  </p>
  <p style="color:#999;font-size:12px;">If you weren't expecting this invite, you can safely ignore it.</p>
</body>
</html>`,
    text: `${inviterName} invited you to join ${workspaceName} on Kanbanica.\n\nAccept the invite (expires in 7 days):\n${url}\n\nIf you weren't expecting this, ignore this email.`,
  };
}

export function workspaceDeletedEmail({ workspaceName }: { workspaceName: string }) {
  return {
    subject: `Your workspace "${workspaceName}" has been deleted`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">Kanbanica</h2>
  <p>Your workspace <strong>${workspaceName}</strong> and all of its data have been permanently deleted.</p>
  <p style="color:#999;font-size:12px;">This action cannot be undone. If you didn't request this, contact support immediately.</p>
</body>
</html>`,
    text: `Your workspace "${workspaceName}" and all of its data have been permanently deleted.\n\nIf you didn't request this, contact support immediately.`,
  };
}
