import { Component, type ReactNode } from 'react'
import { useI18n } from '../i18n/context'

function Fallback() {
  const { t } = useI18n()
  return (
    <div role="alert" className="mx-auto max-w-md p-6">
      <p className="mb-3">{t('err.boundary')}</p>
      <button onClick={() => window.location.reload()} className="rounded-full bg-indigo-600 px-4 py-2 font-semibold text-white">
        {t('err.reload')}
      </button>
    </div>
  )
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('Unhandled UI error', error)
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children
  }
}
