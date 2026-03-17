import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

type Status = 'loading' | 'empty' | 'ready'
type ActionStatus = 'idle' | 'loading' | 'success' | 'error'

interface MetricCard {
  id: string
  title: string
  value: string
  unit?: string
  subtitle: string
  accent: string
}

interface ActionItem {
  id: 'run' | 'club'
  title: string
  subtitle: string
}

interface Toast {
  id: string
  message: string
  tone: 'success' | 'error'
}

const SAMPLE_DATA: MetricCard[] = [
  {
    id: 'distance',
    title: '跑步距离',
    value: '4675-5175',
    unit: 'm',
    subtitle: '目标 5.0 km，系统随机生成上述范围跑步距离',
    accent: 'linear-gradient(135deg, #0A84FF, #64D2FF)'
  },
  {
    id: 'time',
    title: '用时',
    value: '31-36 ',
    unit: 'min',
    subtitle: '系统随机生成合理范围内的跑步用时',
    accent: 'linear-gradient(135deg, #30D158, #A5F3A6)'
  }
]

const ACTIONS: ActionItem[] = [
  {
    id: 'run',
    title: '提交跑步记录',
    subtitle: '生成轨迹并提交记录'
  },
  {
    id: 'club',
    title: '俱乐部签到',
    subtitle: '自动签到或签退'
  }
]

const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://1411644279-3bbgbcxybb.ap-guangzhou.tencentscf.com'

const defaultActionState = ACTIONS.reduce<Record<string, { status: ActionStatus; message: string }>>(
  (acc, action) => {
    acc[action.id] = { status: 'idle', message: '' }
    return acc
  },
  {}
)

export default function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [cards, setCards] = useState<MetricCard[]>([])
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateSW, setUpdateSW] = useState<(reload?: boolean) => void>(() => () => {})
  const [actionState, setActionState] = useState(defaultActionState)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const update = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true)
        window.dispatchEvent(new CustomEvent('pwa:need-refresh'))
      },
      onOfflineReady() {
        window.dispatchEvent(new CustomEvent('pwa:offline-ready'))
      }
    })
    setUpdateSW(() => update)
  }, [])

  const loadData = (forceEmpty = false) => {
    setStatus('loading')
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
    }
    timerRef.current = window.setTimeout(() => {
      const data = forceEmpty ? [] : SAMPLE_DATA
      setCards(data)
      setStatus(data.length === 0 ? 'empty' : 'ready')
    }, 900)
  }

  useEffect(() => {
    loadData(false)
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleRefresh = () => {
    updateSW(true)
    setNeedRefresh(false)
  }

  const pushToast = (message: string, tone: Toast['tone']) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, tone }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 3200)
  }

  const runAction = async (action: ActionItem) => {
    setActionState((prev) => ({
      ...prev,
      [action.id]: { status: 'loading', message: '处理中…' }
    }))
    try {
      const payload: Record<string, string> = { action: action.id }
      if (phone.trim()) {
        payload.phone = phone.trim()
      }
      if (password.trim()) {
        payload.password = password.trim()
      }

      const endpoint =
        API_BASE === '/api' || API_BASE.endsWith('/api') ? `${API_BASE}/${action.id}` : API_BASE
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const rawText = await response.text().catch(() => '')
      let data: any = {}
      if (rawText) {
        try {
          data = JSON.parse(rawText)
        } catch {
          data = {}
        }
      }

      if (!response.ok) {
        const message =
          typeof data?.msg === 'string'
            ? data.msg
            : rawText
              ? rawText
              : `请求失败 (${response.status})`
        throw new Error(message)
      }
      if (typeof data?.code === 'number' && data.code !== 10000) {
        throw new Error(data?.msg ?? '操作失败')
      }
      const activityName = data?.response?.activityName as string | undefined
      const backendMsg = typeof data?.msg === 'string' && data.msg.trim() ? data.msg.trim() : '操作成功'
      const successMessage =
        action.id === 'club' && activityName ? `${backendMsg}：${activityName}` : backendMsg
      setActionState((prev) => ({
        ...prev,
        [action.id]: { status: 'success', message: successMessage }
      }))
      pushToast(successMessage, 'success')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '请求失败'
      setActionState((prev) => ({
        ...prev,
        [action.id]: { status: 'error', message: errorMessage }
      }))
      pushToast(errorMessage, 'error')
    }
  }

  return (
    <div className="app">
      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast glass ${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      )}
      <header className="header glass">
        <div className="title-block">
          <p className="eyebrow">Campus Run</p>
          <h1>今日概览</h1>
          <p className="subtitle">基于 serverless 架构、轻盈、稳定、随时可用</p>
        </div>
        {/* <button className="avatar" aria-label="用户头像">
          <span>JS</span>
        </button> */}
      </header>

      <main className="body">
        <section className="cards">
          {status === 'loading' && (
            <>
              {[0, 1, 2].map((key) => (
                <div className="card skeleton" key={key}>
                  <div className="skeleton-icon" />
                  <div className="skeleton-lines">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ))}
            </>
          )}

          {status === 'empty' && (
            <div className="empty glass">
              <h2>暂无数据</h2>
              <p>网络连接正常后会自动更新</p>
              <button className="secondary" onClick={() => loadData(false)}>
                重新加载
              </button>
            </div>
          )}

          {status === 'ready' &&
            cards.map((card) => (
              <div className="card" key={card.id}>
                <div className="card-icon" style={{ background: card.accent }}>
                  <span>{card.title.slice(0, 1)}</span>
                </div>
                <div className="card-body">
                  <p className="card-title">{card.title}</p>
                  <p className="card-value">
                    {card.value}
                    {card.unit && <span>{card.unit}</span>}
                  </p>
                  <p className="card-subtitle">{card.subtitle}</p>
                </div>
              </div>
            ))}
        </section>

        <section className="actions">
          <div className="actions-header">
            <h2>快捷操作</h2>
            <p>一键提交跑步记录或完成签到</p>
          </div>
          <div className="credentials glass">
            <div className="credentials-header">
              <h3>unirun账号</h3>
              <span>可选</span>
            </div>
            <div className="credentials-grid">
              <label>
                <span>手机号</span>
                <input
                  placeholder="已在云函数配置可留空"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
              </label>
              <label>
                <span>密码</span>
                <input
                  type="password"
                  placeholder="仅在本地使用"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </div>
            <p className="credentials-tip">如果后端已配置环境变量，可留空直接操作。</p>
          </div>
          <div className="actions-grid">
            {ACTIONS.map((action) => {
              const state = actionState[action.id]
              return (
                <button
                  key={action.id}
                  className={`action-card ${state.status}`}
                  onClick={() => runAction(action)}
                  disabled={state.status === 'loading'}
                >
                  <div className="action-info">
                    <p className="action-title">{action.title}</p>
                    <p className="action-sub">{action.subtitle}</p>
                    {state.message && (
                      <p className={`action-status ${state.status}`}>{state.message}</p>
                    )}
                  </div>
                  <div className="action-cta">
                    {state.status === 'loading' ? '处理中…' : '开始'}
                  </div>
                </button>
              )
            })}
          </div>
        </section>
      </main>

      <footer className="footer glass">
        <button className="tab active">概览</button>
        <button className="tab">记录</button>
        <button className="tab">我的</button>
      </footer>

      {needRefresh && (
        <div className="update-banner glass" role="status" aria-live="polite">
          <div>
            <p className="update-title">发现新版本</p>
            <p className="update-sub">请点击刷新以获取最新内容</p>
          </div>
          <button className="primary" onClick={handleRefresh}>
            刷新
          </button>
        </div>
      )}
    </div>
  )
}
