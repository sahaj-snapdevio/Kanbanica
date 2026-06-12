export function magicLinkEmail({ url, appName = "SaaS Starter" }: { url: string; appName?: string }) {
  return {
    subject: `Your sign-in link for ${appName}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin-bottom: 8px;">${appName}</h2>
  <p>Click the button below to sign in. The link expires in 10 minutes.</p>
  <a href="${url}" style="display:inline-block;padding:12px 24px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Sign in</a>
  <p style="margin-top:24px;color:#666;font-size:13px;">
    Or copy this URL into your browser:<br>
    <a href="${url}" style="color:#666;word-break:break-all;">${url}</a>
  </p>
  <p style="color:#999;font-size:12px;">If you didn't request this, you can safely ignore it.</p>
</body>
</html>`,
    text: `Sign in to ${appName}\n\nClick this link to sign in (expires in 10 minutes):\n${url}\n\nIf you didn't request this, ignore this email.`,
  };
}
