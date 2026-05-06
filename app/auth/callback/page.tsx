'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase, supabaseConfig } from '@/lib/supabase'
import { Loader2Icon, CheckCircle2Icon, XCircleIcon } from 'lucide-react'

export default function AuthCallback() {
  useEffect(() => {
    window.location.href = '/dashboard'
  }, [])
  
  return null
}

const cbStyles = `
  .auth-cb-page { position:fixed;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;font-family:var(--font-open-sans,system-ui,sans-serif); }
  .auth-cb-bg { position:absolute;inset:0;background:oklch(0.12 0.008 280);background-image:radial-gradient(at 20% 20%,oklch(0.18 0.04 150/40%) 0px,transparent 50%),radial-gradient(at 80% 80%,oklch(0.15 0.03 280/30%) 0px,transparent 50%); }
  .auth-cb-center { position:relative;z-index:10;padding:24px; }
  .auth-cb-card { max-width:420px;background:oklch(0.16 0.005 280/80%);backdrop-filter:blur(40px) saturate(1.5);border:1px solid oklch(1 0 0/8%);border-radius:24px;padding:40px 32px;text-align:center;box-shadow:0 20px 60px -10px oklch(0 0 0/50%);animation:auth-cb-enter .5s cubic-bezier(.16,1,.3,1); }
  @keyframes auth-cb-enter { from{opacity:0;transform:translateY(16px) scale(.97)} to{opacity:1;transform:translateY(0) scale(1)} }
  .auth-cb-icon-wrap { width:64px;height:64px;margin:0 auto 16px;border-radius:18px;display:flex;align-items:center;justify-content:center; }
  .auth-cb-icon-loading { background:oklch(0.65 0.15 150/10%);color:oklch(0.65 0.15 150); }
  .auth-cb-icon-success { background:oklch(0.65 0.15 150/15%);color:oklch(0.65 0.15 150); }
  .auth-cb-icon-error { background:oklch(0.60 0.15 25/15%);color:oklch(0.75 0.15 25); }
  .auth-cb-icon { width:32px;height:32px; }
  .auth-cb-spin { animation:auth-cb-spin-anim .8s linear infinite; }
  @keyframes auth-cb-spin-anim { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
  .auth-cb-title { font-size:18px;font-weight:700;color:oklch(0.96 0.005 280);margin:0 0 6px; }
  .auth-cb-desc { font-size:14px;color:oklch(0.55 0.005 280);margin:0; }
  .auth-cb-redirect-hint { font-size:12px;color:oklch(0.40 0.005 280);margin-top:12px; }
  .auth-cb-error-title { color:oklch(0.75 0.15 25);font-size:18px;font-weight:700;margin:0 0 8px; }
  .auth-cb-error-list { background:oklch(0.15 0.04 25/30%);border-radius:12px;padding:12px 16px;text-align:left;font-size:13px;color:oklch(0.80 0.08 25);margin-top:12px; }
  .auth-cb-error-list ul { margin:6px 0 0;padding-left:20px; }
`
