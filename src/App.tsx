import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

type Status = 'loading' | 'empty' | 'ready'
type ActionStatus = 'idle' | 'loading' | 'success' | 'error'
type PageTab = 'run' | 'club' | 'mine'

interface ProgressCard {
  id: string
  title: string
  current: number
  target: number
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

interface ClubActivityItem {
  id: string
  activityId: number
  title: string
  startTime: string
  endTime: string
  address: string
  joined: number
  capacity: number
  isJoined: boolean
  isFull: boolean
}

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

const PAGE_META: Record<PageTab, { eyebrow: string; title: string; subtitle: string }> = {
  run: {
    eyebrow: '',
    title: '校园跑',
    subtitle: ''
  },
  club: {
    eyebrow: '',
    title: '俱乐部',
    subtitle: '查看签到状态并完成一键签到/签退'
  },
  mine: {
    eyebrow: '',
    title: '',
    subtitle: ''
  }
}

const API_BASE =
  import.meta.env.VITE_API_BASE ?? 'https://1411644279-3bbgbcxybb.ap-guangzhou.tencentscf.com'

const defaultActionState = ACTIONS.reduce<Record<string, { status: ActionStatus; message: string }>>(
  (acc, action) => {
    acc[action.id] = { status: 'idle', message: '' }
    return acc
  },
  {}
)

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

const firstNumber = (obj: unknown, keys: string[]): number | null => {
  if (!obj || typeof obj !== 'object') {
    return null
  }
  const record = obj as Record<string, unknown>
  for (const key of keys) {
    const value = asNumber(record[key])
    if (value !== null) {
      return value
    }
  }
  return null
}

const toKm = (distanceLike: number): number => {
  if (!Number.isFinite(distanceLike)) {
    return 0
  }
  if (Math.abs(distanceLike) >= 1000) {
    return distanceLike / 1000
  }
  return distanceLike
}

const formatDisplayNumber = (value: number): string => {
  if (Math.abs(value - Math.round(value)) < 1e-6) {
    return String(Math.round(value))
  }
  return value.toFixed(1)
}

const normalizeErrorMessage = (raw: unknown, fallback = '请求失败，请稍后重试'): string => {
  if (typeof raw !== 'string') {
    return fallback
  }
  const compact = raw
    .replace(/\\"/g, '"')
    .replace(/\\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!compact) {
    return fallback
  }

  const msgMatch = compact.match(/"msg"\s*:\s*"([^"]+)"/i)
  const messageFieldMatch = compact.match(/"Message"\s*:\s*"([^"]+)"/)
  const picked = (msgMatch?.[1] || messageFieldMatch?.[1] || compact).trim()
  if (picked.length > 80) {
    return `${picked.slice(0, 80)}...`
  }
  return picked
}

const getTodayLocalDate = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const SESSION_KEY_STORAGE = 'autorun_session_key'

export default function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [cards, setCards] = useState<ProgressCard[]>([])
  const [runDataMessage, setRunDataMessage] = useState('请填写账号后刷新进度')
  const [needRefresh, setNeedRefresh] = useState(false)
  const [updateSW, setUpdateSW] = useState<(reload?: boolean) => void>(() => () => {})
  const [actionState, setActionState] = useState(defaultActionState)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [adminToken, setAdminToken] = useState('')
  const [sessionKey, setSessionKey] = useState(() => {
    if (typeof window === 'undefined') {
      return ''
    }
    return window.localStorage.getItem(SESSION_KEY_STORAGE) ?? ''
  })
  const [activeTab, setActiveTab] = useState<PageTab>('run')
  const [clubStatus, setClubStatus] = useState<Status>('loading')
  const [clubMessage, setClubMessage] = useState('请填写账号后刷新俱乐部数据')
  const [clubJoined, setClubJoined] = useState(0)
  const [clubTarget, setClubTarget] = useState(12)
  const [clubActivities, setClubActivities] = useState<ClubActivityItem[]>([])
  const [clubActionLoading, setClubActionLoading] = useState<Record<string, boolean>>({})
  const [clubQueryDate, setClubQueryDate] = useState(getTodayLocalDate())
  const [manualLoadingCount, setManualLoadingCount] = useState(0)

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

  const requestJSON = async (
    payload: Record<string, unknown>,
    options?: { userInitiated?: boolean }
  ) => {
    const userInitiated = options?.userInitiated === true
    if (userInitiated) {
      setManualLoadingCount((prev) => prev + 1)
    }
    try {
    const action = String(payload.action ?? '')
    const endpoint =
      API_BASE === '/api' || API_BASE.endsWith('/api') ? `${API_BASE}/${action}` : API_BASE
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
        if (typeof data === 'string') {
          const trimmed = data.trim()
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              data = JSON.parse(trimmed)
            } catch {
              data = { msg: data }
            }
          } else {
            data = { msg: data }
          }
        }
      } catch {
        data = {}
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        setSessionKey('')
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(SESSION_KEY_STORAGE)
        }
      }
      const message =
        typeof data?.msg === 'string'
          ? data.msg
          : rawText
            ? rawText
            : `请求失败 (${response.status})`
      throw new Error(normalizeErrorMessage(message))
    }
    if (typeof data?.code === 'number' && data.code !== 10000) {
      throw new Error(normalizeErrorMessage(data?.msg ?? '操作失败'))
    }
    const nextSessionKey = data?.response?.sessionKey
    if (typeof nextSessionKey === 'string' && nextSessionKey.trim()) {
      const normalized = nextSessionKey.trim()
      setSessionKey(normalized)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SESSION_KEY_STORAGE, normalized)
      }
    }
    return data
    } finally {
      if (userInitiated) {
        setManualLoadingCount((prev) => Math.max(0, prev - 1))
      }
    }
  }

  const applyAuthPayload = (payload: Record<string, unknown>) => {
    if (phone.trim()) {
      payload.phone = phone.trim()
    }
    if (password.trim()) {
      payload.password = password.trim()
    }
    if (adminToken.trim()) {
      payload.adminToken = adminToken.trim()
    }
    if (sessionKey.trim()) {
      payload.sessionKey = sessionKey.trim()
    }
  }

  const loadData = async (manual = false) => {
    setStatus('loading')
    try {
      const payload: Record<string, unknown> = { action: 'run_info' }
      applyAuthPayload(payload)

      const data = await requestJSON(payload, { userInitiated: manual })
      const runInfo = data?.response?.runInfo ?? {}
      const runStandard = data?.response?.runStandard ?? {}

      const currentCount = firstNumber(runInfo, ['runValidCount', 'runCount']) ?? 0
      const countTargetRaw =
        firstNumber(runStandard, [
          'runTimes',
          'runCount',
          'targetRunCount',
          'minRunCount',
          'effectiveRunCount',
          'totalRunCount'
        ]) ?? 20
      const countTarget = Math.max(countTargetRaw, currentCount || 0, 1)

      const currentDistance = toKm(firstNumber(runInfo, ['runValidDistance', 'runDistance']) ?? 0)
      const distanceTargetRaw =
        firstNumber(runStandard, [
          'runDistance',
          'targetDistance',
          'minRunDistance',
          'effectiveDistance',
          'totalDistance'
        ]) ?? 60
      const distanceTarget = Math.max(toKm(distanceTargetRaw), currentDistance || 0, 1)

      const nextCards: ProgressCard[] = [
        {
          id: 'count-progress',
          title: '校园跑次数进度',
          current: currentCount,
          target: countTarget,
          unit: '次',
          subtitle: '本学期有效打卡次数',
          accent: 'linear-gradient(90deg, #4f8cff, #55d6ff)'
        },
        {
          id: 'distance-progress',
          title: '校园跑距离进度',
          current: Number(currentDistance.toFixed(1)),
          target: Number(distanceTarget.toFixed(1)),
          unit: 'km',
          subtitle: '本学期累计有效距离',
          accent: 'linear-gradient(90deg, #ff9f43, #ffd166)'
        }
      ]

      setCards(nextCards)
      setRunDataMessage('已从后端同步校园跑进度')
      setStatus(nextCards.length === 0 ? 'empty' : 'ready')
    } catch (err) {
      setCards([])
      setStatus('empty')
      setRunDataMessage(normalizeErrorMessage(err instanceof Error ? err.message : '', '加载校园跑进度失败'))
    }
  }

  const loadClubData = async (manual = false) => {
    setClubStatus('loading')
    try {
      const payload: Record<string, unknown> = { action: 'club_data' }
      if (clubQueryDate) {
        payload.queryDate = clubQueryDate
      }
      applyAuthPayload(payload)

      const data = await requestJSON(payload, { userInitiated: manual })
      const joinProgress = data?.response?.joinProgress ?? {}
      const joined = firstNumber(joinProgress, ['joinNum']) ?? 0
      const targetRaw = firstNumber(joinProgress, ['totalNum']) ?? 12
      const target = Math.max(targetRaw, joined, 1)

      const rawActivities = Array.isArray(data?.response?.activities) ? data.response.activities : []
      const mappedActivities: ClubActivityItem[] = rawActivities.map((item: any, index: number) => {
        const startTime = typeof item?.startTime === 'string' ? item.startTime : '--:--'
        const endTime = typeof item?.endTime === 'string' ? item.endTime : '--:--'
        const joinedCount = firstNumber(item, ['signInStudent', 'applyStudentCount']) ?? 0
        const capacity = firstNumber(item, ['maxStudent']) ?? 0
        const cancelSign = String(item?.cancelSign ?? '')
        const optionStatus = String(item?.optionStatus ?? '').trim()
        const fullFlag = String(item?.fullActivity ?? '')
        // optionStatus in current backend payload is numeric code (e.g. "6"/"7"),
        // so we only treat explicit text flags as joined to avoid false positives.
        const isJoined = optionStatus.includes('取消报名') || optionStatus.includes('已报名')
        const isFull = fullFlag === '1' || (capacity > 0 && joinedCount >= capacity)

        return {
          id: String(item?.clubActivityId ?? item?.activityId ?? index),
          activityId: Number(item?.clubActivityId ?? item?.activityId ?? 0),
          title: typeof item?.activityName === 'string' && item.activityName ? item.activityName : '未命名活动',
          startTime,
          endTime,
          address:
            typeof item?.addressDetail === 'string' && item.addressDetail
              ? item.addressDetail
              : typeof item?.teacherName === 'string' && item.teacherName
                ? item.teacherName
                : '地点待公布',
          joined: joinedCount,
          capacity,
          isJoined,
          isFull
        }
      })

      setClubJoined(joined)
      setClubTarget(target)
      setClubActivities(mappedActivities)
      setClubStatus(mappedActivities.length === 0 ? 'empty' : 'ready')
      setClubMessage(`已同步 ${clubQueryDate} 的俱乐部活动`)
    } catch (err) {
      setClubActivities([])
      setClubStatus('empty')
      setClubMessage(normalizeErrorMessage(err instanceof Error ? err.message : '', '加载俱乐部数据失败'))
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeTab === 'club') {
      void loadClubData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, clubQueryDate])

  const handleRefresh = () => {
    updateSW(true)
    setNeedRefresh(false)
  }

  const pushToast = (message: string, tone: Toast['tone']) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`
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
      const payload: Record<string, unknown> = { action: action.id }
      applyAuthPayload(payload)

      const data = await requestJSON(payload, { userInitiated: true })
      const activityName = data?.response?.activityName as string | undefined
      const backendMsg = typeof data?.msg === 'string' && data.msg.trim() ? data.msg.trim() : '操作成功'
      const successMessage =
        action.id === 'club' && activityName ? `${backendMsg}：${activityName}` : backendMsg
      setActionState((prev) => ({
        ...prev,
        [action.id]: { status: 'success', message: successMessage }
      }))
      pushToast(successMessage, 'success')
      if (action.id === 'run') {
        void loadData()
      }
      if (action.id === 'club') {
        void loadClubData()
      }
    } catch (err) {
      const errorMessage = normalizeErrorMessage(err instanceof Error ? err.message : '', '请求失败')
      setActionState((prev) => ({
        ...prev,
        [action.id]: { status: 'error', message: errorMessage }
      }))
      pushToast(errorMessage, 'error')
    }
  }

  const toggleClubJoin = async (activity: ClubActivityItem) => {
    if (!activity.activityId) {
      pushToast('活动ID无效', 'error')
      return
    }
    const action = activity.isJoined ? 'club_cancel' : 'club_join'
    setClubActionLoading((prev) => ({ ...prev, [activity.id]: true }))
    try {
      const payload: Record<string, unknown> = {
        action,
        activityId: activity.activityId
      }
      applyAuthPayload(payload)
      await requestJSON(payload, { userInitiated: true })
      pushToast(activity.isJoined ? '已取消报名' : '报名成功', 'success')
      await loadClubData(true)
    } catch (err) {
      pushToast(normalizeErrorMessage(err instanceof Error ? err.message : '', '操作失败'), 'error')
    } finally {
      setClubActionLoading((prev) => ({ ...prev, [activity.id]: false }))
    }
  }

  const renderActionCard = (actionId: ActionItem['id']) => {
    const action = ACTIONS.find((item) => item.id === actionId)
    if (!action) {
      return null
    }
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
          {state.message && <p className={`action-status ${state.status}`}>{state.message}</p>}
        </div>
        <div className="action-cta">{state.status === 'loading' ? '处理中…' : '开始'}</div>
      </button>
    )
  }

  const renderCredentials = () => (
    <div className="credentials glass">
      <div className="credentials-header">
        <h3>unirun账号</h3>
        <span>必填</span>
      </div>
      <div className="credentials-grid">
        <label>
          <span>手机号</span>
          <input
            placeholder="普通用户必填"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            placeholder="普通用户必填"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          <span>管理员口令（仅你本人）</span>
          <input
            type="password"
            placeholder="设置 ADMIN_TOKEN 后可免填账号"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
          />
        </label>
      </div>
      <p className="credentials-tip">普通用户必须输入账号密码；管理员口令通过后端 ADMIN_TOKEN 验证。</p>
    </div>
  )

  const pageMeta = PAGE_META[activeTab]
  const clubRate = Math.max(0, Math.min(100, (clubJoined / Math.max(clubTarget, 1)) * 100))
  const weekLabels = ['一', '二', '三', '四', '五', '六', '日']
  const weekDates = Array.from({ length: 7 }).map((_, index) => {
    const date = new Date()
    date.setDate(date.getDate() + index)
    const full = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate()
    ).padStart(2, '0')}`
    return {
      day: weekLabels[(date.getDay() + 6) % 7],
      date: String(date.getDate()).padStart(2, '0'),
      full,
      active: full === clubQueryDate
    }
  })

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

      <header className={`header ${activeTab === 'club' ? 'club-header' : ''}`}>
        <div className="title-block">
          <p className="eyebrow">{pageMeta.eyebrow}</p>
          <h1>{pageMeta.title}</h1>
          <p className="subtitle">{pageMeta.subtitle}</p>
        </div>
      </header>

      <main className="body">
        {activeTab === 'run' && (
          <>
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
                  <button className="secondary" onClick={() => void loadData(true)}>
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
                        {formatDisplayNumber(card.current)}/{formatDisplayNumber(card.target)}
                        {card.unit && <span>{card.unit}</span>}
                      </p>
                      <div className="skill-bar" aria-label={`${card.title}进度`}>
                        <span
                          className="skill-per"
                          style={{
                            width: `${Math.max(0, Math.min(100, (card.current / card.target) * 100))}%`,
                            background: card.accent
                          }}
                        >
                          <span className="tooltip">
                            {Math.round(Math.max(0, Math.min(100, (card.current / card.target) * 100)))}%
                          </span>
                        </span>
                      </div>
                      <p className="card-subtitle">{card.subtitle}</p>
                    </div>
                  </div>
                ))}
            </section>

            <section className="actions">
              <div className="actions-header">
                <h2>校园跑</h2>
                <p>{runDataMessage}</p>
              </div>
              <button className="secondary refresh-btn" onClick={() => void loadData(true)}>
                刷新进度
              </button>
              <div className="actions-grid">{renderActionCard('run')}</div>
            </section>
          </>
        )}

        {activeTab === 'club' && (
          <section className="club-page">
            <div className="club-hero">
              <p>运动让生活更美好</p>
              <div className="club-loader">
                <div className="club-truck-wrapper">
                  <div className="club-truck-body">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 198 93" className="club-truck-svg">
                      <path strokeWidth={3} stroke="#282828" fill="#F83D3D" d="M135 22.5H177.264C178.295 22.5 179.22 23.133 179.594 24.0939L192.33 56.8443C192.442 57.1332 192.5 57.4404 192.5 57.7504V89C192.5 90.3807 191.381 91.5 190 91.5H135C133.619 91.5 132.5 90.3807 132.5 89V25C132.5 23.6193 133.619 22.5 135 22.5Z" />
                      <path strokeWidth={3} stroke="#282828" fill="#7D7C7C" d="M146 33.5H181.741C182.779 33.5 183.709 34.1415 184.078 35.112L190.538 52.112C191.16 53.748 189.951 55.5 188.201 55.5H146C144.619 55.5 143.5 54.3807 143.5 53V36C143.5 34.6193 144.619 33.5 146 33.5Z" />
                      <path strokeWidth={2} stroke="#282828" fill="#282828" d="M150 65C150 65.39 149.763 65.8656 149.127 66.2893C148.499 66.7083 147.573 67 146.5 67C145.427 67 144.501 66.7083 143.873 66.2893C143.237 65.8656 143 65.39 143 65C143 64.61 143.237 64.1344 143.873 63.7107C144.501 63.2917 145.427 63 146.5 63C147.573 63 148.499 63.2917 149.127 63.7107C149.763 64.1344 150 64.61 150 65Z" />
                      <rect strokeWidth={2} stroke="#282828" fill="#FFFCAB" rx={1} height={7} width={5} y={63} x={187} />
                      <rect strokeWidth={2} stroke="#282828" fill="#282828" rx={1} height={11} width={4} y={81} x={193} />
                      <rect strokeWidth={3} stroke="#282828" fill="#DFDFDF" rx="2.5" height={90} width={121} y="1.5" x="6.5" />
                      <rect strokeWidth={2} stroke="#282828" fill="#DFDFDF" rx={2} height={4} width={6} y={84} x={1} />
                    </svg>
                  </div>
                  <div className="club-truck-tires">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 30 30">
                      <circle strokeWidth={3} stroke="#282828" fill="#282828" r="13.5" cy={15} cx={15} />
                      <circle fill="#DFDFDF" r={7} cy={15} cx={15} />
                    </svg>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 30 30">
                      <circle strokeWidth={3} stroke="#282828" fill="#282828" r="13.5" cy={15} cx={15} />
                      <circle fill="#DFDFDF" r={7} cy={15} cx={15} />
                    </svg>
                  </div>
                  <div className="club-road" />
                  <svg xmlSpace="preserve" viewBox="0 0 453.459 453.459" xmlnsXlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" id="Capa_1" version="1.1" fill="#000000" className="club-lamp-post">
                    <path d="M252.882,0c-37.781,0-68.686,29.953-70.245,67.358h-6.917v8.954c-26.109,2.163-45.463,10.011-45.463,19.366h9.993
      c-1.65,5.146-2.507,10.54-2.507,16.017c0,28.956,23.558,52.514,52.514,52.514c28.956,0,52.514-23.558,52.514-52.514
      c0-5.478-0.856-10.872-2.506-16.017h9.992c0-9.354-19.352-17.204-45.463-19.366v-8.954h-6.149C200.189,38.779,223.924,16,252.882,16
      c29.952,0,54.32,24.368,54.32,54.32c0,28.774-11.078,37.009-25.105,47.437c-17.444,12.968-37.216,27.667-37.216,78.884v113.914
      h-0.797c-5.068,0-9.174,4.108-9.174,9.177c0,2.844,1.293,5.383,3.321,7.066c-3.432,27.933-26.851,95.744-8.226,115.459v11.202h45.75
      v-11.202c18.625-19.715-4.794-87.527-8.227-115.459c2.029-1.683,3.322-4.223,3.322-7.066c0-5.068-4.107-9.177-9.176-9.177h-0.795
      V196.641c0-43.174,14.942-54.283,30.762-66.043c14.793-10.997,31.559-23.461,31.559-60.277C323.202,31.545,291.656,0,252.882,0z
      M232.77,111.694c0,23.442-19.071,42.514-42.514,42.514c-23.442,0-42.514-19.072-42.514-42.514c0-5.531,1.078-10.957,3.141-16.017
      h78.747C231.693,100.736,232.77,106.162,232.77,111.694z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="club-progress">
              <div className="club-progress-track">
                <span className="club-progress-fill" style={{ width: `${clubRate}%` }} />
              </div>
              <div className="club-progress-meta">
                <span>已参加：{clubJoined}次</span>
                <span>目标：{clubTarget}次</span>
              </div>
            </div>

            <div className="club-board">
              <div className="club-board-head">
                <h3>俱乐部活动</h3>
                <button className="club-link" type="button">
                  点日期查询
                </button>
              </div>

              <div className="club-calendar">
                {weekDates.map((item) => (
                  <button
                    key={`${item.day}-${item.date}`}
                    type="button"
                    className={`club-day ${item.active ? 'active' : ''}`}
                    onClick={() => setClubQueryDate(item.full)}
                  >
                    <span>{item.day}</span>
                    <strong>{item.date}</strong>
                  </button>
                ))}
              </div>

              {clubStatus === 'loading' && (
                <div className="club-empty">
                  <p>正在同步俱乐部活动…</p>
                </div>
              )}

              {clubStatus === 'empty' && (
                <div className="club-empty">
                  <p>{clubMessage}</p>
                </div>
              )}

              {clubStatus === 'ready' && (
                <div className="club-list">
                  {clubActivities.map((activity) => (
                    <article className="club-item" key={activity.id}>
                      <h4>{activity.title}</h4>
                      <p>活动时间：{activity.startTime}-{activity.endTime}</p>
                      <p>活动地点：{activity.address}</p>
                      <div className="club-item-meta">
                        <div className="club-item-meta-left">
                          <span>体能教研室</span>
                          <span>
                            {activity.joined} / {activity.capacity || '--'} 人
                          </span>
                        </div>
                        <button
                          className={`club-join-btn ${activity.isJoined ? 'cancel' : 'join'}`}
                          disabled={clubActionLoading[activity.id] || (!activity.isJoined && activity.isFull)}
                          onClick={() => void toggleClubJoin(activity)}
                        >
                          {clubActionLoading[activity.id]
                            ? '处理中'
                            : activity.isJoined
                              ? '取消报名'
                              : activity.isFull
                                ? '已满员'
                                : '报名'}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <button className="secondary refresh-btn" onClick={() => void loadClubData(true)}>
              刷新活动
            </button>
            <div className="actions-grid">{renderActionCard('club')}</div>
          </section>
        )}

        {activeTab === 'mine' && (
          <section className="actions">
            <div className="actions-header">
              <h2>我的</h2>
              <p>账号信息仅用于当前会话请求，不会在前端持久化。</p>
            </div>
            {renderCredentials()}
            
          </section>
        )}
      </main>

      <footer className="footer-nav-wrap">
        <div className="glass-radio-group">
          <input
            type="radio"
            name="page"
            id="tab-run"
            checked={activeTab === 'run'}
            onChange={() => setActiveTab('run')}
          />
          <label htmlFor="tab-run">校园跑</label>

          <input
            type="radio"
            name="page"
            id="tab-club"
            checked={activeTab === 'club'}
            onChange={() => setActiveTab('club')}
          />
          <label htmlFor="tab-club">俱乐部</label>

          <input
            type="radio"
            name="page"
            id="tab-mine"
            checked={activeTab === 'mine'}
            onChange={() => setActiveTab('mine')}
          />
          <label htmlFor="tab-mine">我的</label>

          <div className="glass-glider" />
        </div>
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

      {manualLoadingCount > 0 && (
        <div className="request-loader-overlay" role="status" aria-live="polite" aria-label="请求处理中">
          <div className="request-loader-card">
            <div
              aria-label="Orange and tan hamster running in a metal wheel"
              role="img"
              className="wheel-and-hamster"
            >
              <div className="wheel" />
              <div className="hamster">
                <div className="hamster__body">
                  <div className="hamster__head">
                    <div className="hamster__ear" />
                    <div className="hamster__eye" />
                    <div className="hamster__nose" />
                  </div>
                  <div className="hamster__limb hamster__limb--fr" />
                  <div className="hamster__limb hamster__limb--fl" />
                  <div className="hamster__limb hamster__limb--br" />
                  <div className="hamster__limb hamster__limb--bl" />
                  <div className="hamster__tail" />
                </div>
              </div>
              <div className="spoke" />
            </div>
            <p className="request-loader-text">请求处理中...</p>
          </div>
        </div>
      )}
    </div>
  )
}
