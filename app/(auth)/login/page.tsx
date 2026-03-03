'use client'

/**
 * Login Page
 * 
 * Simple password login for single-tenant DaaS
 */

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Lock, Eye, EyeOff, LogIn, Music, Volume2, VolumeX } from 'lucide-react'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/'

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [isLocalhost, setIsLocalhost] = useState(false)
  const [isConfigured, setIsConfigured] = useState(true)
  const [isPlayingMusic, setIsPlayingMusic] = useState(false)
  const [audioUrl, setAudioUrl] = useState('https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=lofi-study-112191.mp3') // Lofi study music by default

  useEffect(() => {
    try {
      const host = window.location.hostname
      setIsLocalhost(host === 'localhost' || host === '127.0.0.1' || host === '::1')
    } catch {
      setIsLocalhost(false)
    }

    // Get company name from auth status
    fetch('/api/auth/status')
      .then(res => {
        return res.json()
      })
      .then(async (data) => {
        if (!data.isConfigured) {
          setIsConfigured(false)

          // Mostra instrução para configurar MASTER_PASSWORD
          setError('Configure a variável de ambiente MASTER_PASSWORD no Vercel (ou no .env.local para desenvolvimento) e reinicie o servidor.')
          return
        } else if (data.isAuthenticated) {
          router.push('/')
        } else if (data.company) {
          setCompanyName(data.company.name)
        }
      })
      .catch((err) => {
        console.error('🔍 [LOGIN] Auth status error:', err)
      })
  }, [router, isLocalhost])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!password) {
      setError('Digite sua senha')
      return
    }

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao fazer login')
      }

      // Redirect to original destination or dashboard
      router.push(redirectTo)
      router.refresh()

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleMusic = () => {
    const audioEl = document.getElementById('bg-music') as HTMLAudioElement
    if (!audioEl) return

    if (isPlayingMusic) {
      audioEl.pause()
    } else {
      audioEl.play().catch(e => console.error("Audio playback failed:", e))
    }
    setIsPlayingMusic(!isPlayingMusic)
  }

  return (
    <div className="w-full max-w-md">
      {/* Background Audio */}
      <audio id="bg-music" src={audioUrl} loop />

      {/* Music Control / Header Actions */}
      <div className="absolute top-4 right-4 flex gap-2">
        <button
          onClick={toggleMusic}
          className="p-2 rounded-full bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] text-[var(--ds-text-secondary)] hover:text-emerald-500 transition-colors shadow-sm"
          title={isPlayingMusic ? "Pausar música" : "Tocar música"}
        >
          {isPlayingMusic ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </div>
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-linear-to-br from-emerald-500 to-emerald-600 mb-4">
          <span className="text-3xl font-bold text-white">S</span>
        </div>
        <h1 className="text-2xl font-bold text-[var(--ds-text-primary)]">
          {companyName || 'SmartZap'}
        </h1>
        <p className="text-[var(--ds-text-secondary)] mt-1">Entre para continuar</p>
      </div>

      {/* Card */}
      <div className="bg-[var(--ds-bg-elevated)] border border-[var(--ds-border-default)] rounded-2xl p-6 shadow-xl">
        {!isConfigured && (
          <div className="mb-4 bg-[var(--ds-status-warning-bg)] border border-[var(--ds-status-warning)]/20 rounded-xl p-4">
            <p className="text-sm text-[var(--ds-status-warning-text)] font-medium">Configuração pendente</p>
            <p className="text-xs text-[var(--ds-text-secondary)] mt-1">
              Configure a variável de ambiente <code className="bg-[var(--ds-bg-surface)] px-1.5 py-0.5 rounded">MASTER_PASSWORD</code> no Vercel (ou <code className="bg-[var(--ds-bg-surface)] px-1.5 py-0.5 rounded">.env.local</code>) e reinicie o servidor.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--ds-text-muted)]" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              name="password"
              autoComplete="current-password"
              className="w-full bg-[var(--ds-bg-surface)] border border-[var(--ds-border-default)] rounded-xl pl-11 pr-11 py-3 text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-muted)] focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ds-text-muted)] hover:text-[var(--ds-text-secondary)]"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>

          {error && (
            <p className="mt-4 text-[var(--ds-status-error-text)] text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading || !isConfigured}
            className="w-full mt-6 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                Entrar
                <LogIn className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p className="text-center text-[var(--ds-text-muted)] text-sm mt-6">
        SmartZap © {new Date().getFullYear()}
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[var(--ds-bg-base)] flex items-center justify-center p-4">
      <Suspense fallback={
        <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      }>
        <LoginForm />
      </Suspense>
    </div>
  )
}
