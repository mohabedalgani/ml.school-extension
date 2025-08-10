// App.tsx  (complete, ready to paste)
import { useEffect, useMemo, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import Editor from '@monaco-editor/react'
import './index.css'
import { runPython, ensurePyodide } from './pyRunner'

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type TocAction = { label: string; action?: 'command' | 'browser' | 'tests' | 'file'; target?: string; terminal?: string }
type TocLesson = { label: string; markdown?: string; file?: string; actions?: TocAction[] }
type TocSession = { label: string; description?: string; lessons?: TocLesson[] }

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function formatTerminalOutput(text: string) {
  const maxWidth = 80
  const lines = text.split('\n')
  const wrappedLines = lines.flatMap(line => {
    if (line.match(/\s{3,}/)) return [line]
    if (line.length <= maxWidth) return [line]
    const parts = []
    let start = 0
    while (start < line.length) {
      parts.push(line.slice(start, start + maxWidth))
      start += maxWidth
    }
    return parts.map((p, i) => (i === 0 ? p : '  ' + p))
  })
  return wrappedLines.join('\n')
}

function TerminalHeading({ text }: { text: string }) {
  const upper = text.toUpperCase()
  const underline = '─'.repeat(upper.length)
  const padLeft = Math.floor((80 - upper.length) / 2)
  return (
    <>
      {' '.repeat(padLeft) + upper}
      {'\n'}
      {' '.repeat(padLeft) + underline}
    </>
  )
}

// Build a unicode box table as a plain string for Monaco display
function buildTableString(headers: string[], rows: (string | number)[][]): string {
  const padding = 1
  const colWidths = headers.map((h, i) => {
    const cells = rows.map(r => String(r[i] ?? ''))
    return Math.max(h.length, ...cells.map(c => c.length)) + padding * 2
  })
  const line = (l: string, m: string, r: string) => l + colWidths.map(w => '─'.repeat(w)).join(m) + r
  const top = line('┌', '┬', '┐')
  const mid = line('├', '┼', '┤')
  const bot = line('└', '┴', '┘')
  const head = '│' + headers.map((h, i) => ` ${h} `.padEnd(colWidths[i], ' ')).join('│') + '│'
  const body = rows
    .map((row, ri) => {
      const txt = '│' + row.map((c, i) => (' ' + String(c)).padEnd(colWidths[i], ' ')).join('│') + '│'
      return ri < rows.length - 1 ? txt + '\n' + mid : txt
    })
    .join('\n')
  return [top, head, mid, body, bot].join('\n')
}

function TerminalNote({ label, text }: { label: string; text: string }) {
  const labelWidth = 8
  const paddedLabel = label.padEnd(labelWidth, ' ')
  const displayText = text.length > 80 ? text.substring(0, 75) + '...' : text
  const lines = formatTerminalOutput(displayText).split('\n')
  return lines
    .map((line, i) =>
      i === 0 ? `• [${paddedLabel}] ${line}` : ' '.repeat(labelWidth + 4) + line
    )
    .join('\n')
}

function TerminalFooter() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  return (
    `\n─────────────\n` +
    `🕒 ${yyyy}-${mm}-${dd} ${hh}:${min}    ` +
    `Hint: Use ▶ runAction(action) to execute commands.\n`
  )
}

function TerminalOutput({ output }: { output: string }) {
  const lines = output.split('\n')
  const renderedLines = lines.map(line => {
    if (line.startsWith('$ ')) return `▶ ${line.slice(2)}`
    if (/Warning:/i.test(line) || /DeprecationWarning/i.test(line))
      return TerminalNote({ label: 'Warning', text: line })
    if (line.startsWith('===') && line.endsWith('===')) return line
    if (line.startsWith('===')) return line
    if (line.trim() === '') return ''
    return `  ${line}`
  })
  return (
    <>
      {TerminalHeading({ text: 'TERMINAL OUTPUT' })}
      {'\n\n'}
      {renderedLines.join('\n')}
      {TerminalFooter()}
    </>
  )
}

function ModeToggle() {
  const [night, setNight] = useState<boolean>(() => localStorage.getItem('tocMode') === 'night')
  useEffect(() => {
    document.body.classList.toggle('night', night)
    localStorage.setItem('tocMode', night ? 'night' : 'day')
  }, [night])
  return (
    <button
      onClick={() => setNight(v => !v)}
      title={night ? 'وضع النهار' : 'وضع الليل'}
      style={{
        background: night ? '#282828' : '#f0f0f0',
        color: night ? '#e0e0e0' : '#222',
        border: 'none',
        borderRadius: 20,
        padding: '6px 12px',
        cursor: 'pointer',
      }}
    >
      {night ? '☀️ وضع النهار' : '🌙 وضع الليل'}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Lesson finder helper  (BLOCK 1)                                   */
/* ------------------------------------------------------------------ */
function findLessonByLabel(toc: TocSession[], label: string): TocLesson | undefined {
  for (const session of toc) {
    for (const lesson of session.lessons ?? []) {
      if (lesson.label === label) return lesson
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export default function App() {
  useEffect(() => {
    document.documentElement.setAttribute('dir', 'rtl')
  }, [])

  // Warm up Pyodide early to avoid first-run errors
  useEffect(() => {
    ensurePyodide().catch(() => {/* ignore warmup errors */})
  }, [])

  // Handle window resize for better editor sizing
  useEffect(() => {
    const handleResize = () => {
      if (editorRef.current) {
        setTimeout(() => editorRef.current?.layout(), 0)
        setTimeout(() => editorRef.current?.layout(), 100)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Observe container size for Monaco health checks
  useEffect(() => {
    const el = editorContainerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect
        setContainerSize({ w: Math.round(cr.width), h: Math.round(cr.height) })
        if (cr.height && cr.height > 50 && editorRef.current) {
          // Force layout with error handling
          const forceLayout = () => {
            try {
              editorRef.current?.layout()
            } catch (e) {
              console.warn('Resize layout failed:', e)
            }
          }
          forceLayout()
          setTimeout(forceLayout, 50)
          setTimeout(forceLayout, 200)
        }
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const [toc, setToc] = useState<TocSession[]>([])
  const [currentMarkdownPath, setCurrentMarkdownPath] = useState<string>('')
  const [currentFilePath, setCurrentFilePath] = useState<string>('')
  const [markdownHtml, setMarkdownHtml] = useState<string>(`
    <div style="padding: 20px; text-align: center; color: #666;">
      <h2>مرحباً بك في دليل التعلم الآلي</h2>
      <p>اختر درساً من القائمة الجانبية لبدء التعلم</p>
      <p>Welcome to Machine Learning Guide</p>
      <p>Select a lesson from the sidebar to start learning</p>
    </div>
  `)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [editorValue, setEditorValue] = useState<string>(`# Machine Learning Code Editor
# يتم تحميل المثال تلقائياً عند اختيار الدرس
# Select a lesson from the right panel to load code examples

print("Welcome to ML School!")
print("Select a lesson to get started...")`)
  const [editorLanguage, setEditorLanguage] = useState<'python' | 'markdown' | 'plaintext'>('python')
  const [output, setOutput] = useState<string>('')
  const [running, setRunning] = useState<boolean>(false)
  const [suppressWarnings, setSuppressWarnings] = useState<boolean>(() => {
    const v = localStorage.getItem('suppressWarnings')
    return v === null ? true : v === 'true'
  })
  const outputRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<{ layout: () => void } | null>(null)
  const editorContainerRef = useRef<HTMLDivElement | null>(null)
  const [editorPath, setEditorPath] = useState<string>('sample.py')
  const [selectedKey, setSelectedKey] = useState<string>('')
  const md = useMemo(() => new MarkdownIt({ html: true, breaks: true, linkify: true }), [])

  // Guided exercise state
  const [sampleCode, setSampleCode] = useState<string>('')
  const [exerciseActive, setExerciseActive] = useState<boolean>(false)
  const [exercisePrompts, setExercisePrompts] = useState<string[]>([])
  const [resultText, setResultText] = useState<string>('')
  const [bottomTab, setBottomTab] = useState<'console' | 'result'>('console')
  const [bottomMaximized, setBottomMaximized] = useState<boolean>(false)
  const [editorMaximized, setEditorMaximized] = useState<boolean>(false)

  // Debug/diagnostics state for Monaco
  const [editorStatus, setEditorStatus] = useState<'idle'|'mounting'|'ready'|'error'>('idle')
  const [editorKey, setEditorKey] = useState<number>(0)
  const [containerSize, setContainerSize] = useState<{w:number; h:number}>({w:0,h:0})
  const monacoRef = useRef<unknown>(null)
  const debugLogRef = useRef<string[]>([])

  /* ---------------- TOC load ------------------------------------- */
  useEffect(() => {
    fetch('/.guide/toc.json')
      .then(r => r.json())
      .then(setToc)
      .catch(() => setToc([]))
  }, [])

  /* ---------------- Auto-select "Data Preprocessing" (BLOCK 2) */
  /* ---------- Auto-select "Data Preprocessing" AFTER toc loads ---------- */
  useEffect(() => {
    if (!toc.length) return                    // wait until TOC is loaded
    const lesson = findLessonByLabel(toc, 'Data Preprocessing')
    if (lesson?.file) setCurrentFilePath(lesson.file)      // open in editor
    if (lesson?.markdown) setCurrentMarkdownPath(lesson.markdown) // open in viewer
  }, [toc])                                   // <- runs only when toc changes

  /* ---------------- Markdown loader ------------------------------ */
  useEffect(() => {
    if (!currentMarkdownPath) return
    fetch('/' + currentMarkdownPath)
      .then(r => r.text())
      .then(text => setMarkdownHtml(md.render(text)))
      .catch(() => setMarkdownHtml('<p>تعذر تحميل المحتوى</p>'))
  }, [currentMarkdownPath, md])

  /* ---------------- File loader ---------------------------------- */
  useEffect(() => {
    if (!currentFilePath) return
    fetch('/' + currentFilePath)
      .then(r => r.text())
      .then(text => {
        setEditorValue(text)
        if (currentFilePath.endsWith('.py')) setEditorLanguage('python')
        else if (currentFilePath.endsWith('.md')) setEditorLanguage('markdown')
        else setEditorLanguage('plaintext')
        setEditorPath(currentFilePath)
        // Ensure layout after content change with multiple attempts
        const forceLayoutAfterLoad = () => {
          try {
            editorRef.current?.layout?.()
          } catch (e) {
            console.warn('Layout after load failed:', e)
          }
        }
        setTimeout(forceLayoutAfterLoad, 0)
        setTimeout(forceLayoutAfterLoad, 100)
        setTimeout(forceLayoutAfterLoad, 300)
        setTimeout(forceLayoutAfterLoad, 600)
      })
      .catch(() => setEditorValue(''))
  }, [currentFilePath])

  /* ---------------- Persist suppressWarnings --------------------- */
  useEffect(() => {
    try {
      localStorage.setItem('suppressWarnings', String(suppressWarnings))
    } catch (err) {
      console.warn('Failed to persist setting', err)
    }
  }, [suppressWarnings])

  /* ---------------- Click handlers ------------------------------- */
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement
      let anchor: HTMLAnchorElement | null = null
      if (target?.tagName === 'A') anchor = target as HTMLAnchorElement
      if (target?.tagName === 'CODE' && target.parentElement?.tagName === 'A')
        anchor = target.parentElement as HTMLAnchorElement
      if (!anchor?.href) return
      try {
        const url = new URL(anchor.href)
        if (url.origin === window.location.origin) {
          ev.preventDefault()
          const path = url.pathname.replace(/^\//, '')
          if (path.endsWith('.md')) setCurrentMarkdownPath(path)
          else setCurrentFilePath(path)
        }
      } catch (err) {
        console.warn('Markdown click handling failed', err)
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [contentRef])

  /* ---------------- Utility helpers ------------------------------ */
  function onTocItemClick(lesson: TocLesson, key: string) {
    setSelectedKey(key)
    if (lesson.file) setCurrentFilePath(lesson.file)
    if (lesson.markdown) {
      setCurrentMarkdownPath(lesson.markdown)
    } else if (!lesson.markdown && lesson.file) {
      // If lesson has no markdown but has a file, show a default message about the code example
      setMarkdownHtml(`
        <div style="padding: 20px;">
          <h2>${lesson.label}</h2>
          <p>هذا الدرس يحتوي على مثال برمجي عملي.</p>
          <p>This lesson contains a practical code example.</p>
          <p>يمكنك رؤية الكود في المحرر على اليمين وتشغيله باستخدام الأزرار أدناه.</p>
          <p>You can see the code in the editor on the right and run it using the buttons below.</p>
        </div>
      `)
      setCurrentMarkdownPath('') // Clear the markdown path
    }

    // Guided exercises: provide sample and prompts for specific lessons
    if (lesson.label === 'Data Cleaning Example') {
      // Load the example code as the sample
      fetch('/session2/data_cleaning_example.py')
        .then(r => r.text())
        .then(code => {
          setSampleCode(code)
          setExerciseActive(false)
          setEditorLanguage('python')
          setEditorValue(code) // show sample in Monaco immediately (read-only)
          setExercisePrompts([
            'غيّر طريقة ملء العمود "salary" لاستخدام الوسيط بدلاً من المتوسط.',
            'أضف عموداً جديداً باسم income_k يعرض الدخل بالألوف (salary/1000).',
            'جرّب حدوداً مختلفة لمجموعات العمر في cut لمعرفة تأثيرها.',
          ])
          setEditorPath('session2/data_cleaning_example.py')
        })
        .catch(() => {
          setSampleCode('')
          setExercisePrompts([])
        })
    } else {
      setSampleCode('')
      setExerciseActive(false)
      setExercisePrompts([])
    }
  }

  function appendOutput(text: string) {
    setOutput(o => o + text)
    queueMicrotask(() => {
      const el = outputRef.current
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    })
  }

  function shouldFilterOutput(text: string): boolean {
    if (!suppressWarnings) return false
    const warningPatterns = [
      'Pyarrow will become a required dependency',
      'The behavior will change in pandas 3.0',
      'This inplace method will never work',
      'DeprecationWarning',
      'FutureWarning',
      'Warning:',
      'pandas',
      'inplace method',
      'intermediate object',
    ]
    return warningPatterns.some(pattern => text.includes(pattern))
  }

  /* ---------------- Action runner -------------------------------- */
  async function runAction(action: TocAction) {
    const kind = action.action ?? 'command'
    if (kind === 'browser' && action.target) {
      window.open(action.target, '_blank')
      return
    }
    if (kind === 'file' && action.target) {
      setCurrentFilePath(action.target)
      return
    }
    if (kind === 'tests' && action.target) {
      const [file, command] = action.target.split('|')
      setCurrentFilePath(file.trim())
      appendOutput(`$ ${command.trim()}\n`)
      return
    }
    if (kind === 'command' && action.target) {
      appendOutput(`$ ${action.target}\n`)
      if (action.target.startsWith('python ')) {
        const path = action.target.replace(/^python\s+/, '')
        try {
          setRunning(true)
          appendOutput('... تحميل بايثون (قد يستغرق أول تشغيل دقيقة)\n')
          let code = await fetch('/' + path).then(r => r.text())

          if (suppressWarnings) {
            code = `
import warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)
warnings.filterwarnings('ignore', category=FutureWarning)
warnings.filterwarnings('ignore', message='.*Pyarrow.*')
warnings.filterwarnings('ignore', message='.*pandas.*')
` + code
          }
          let raw = ''
          await runPython(
            code,
            t => {
              if (t.trim() === '' || shouldFilterOutput(t)) return
              if (output && !output.endsWith('\n')) appendOutput('\n')
              appendOutput(t)
              raw += t
            },
            t => {
              if (t.trim() === '' || shouldFilterOutput(t)) return
              if (output && !output.endsWith('\n')) appendOutput('\n')
              appendOutput(t)
              raw += t
            }
          )
          // After run, if this is the preprocessing lesson, render a table summary
          if (path.includes('session2/data_cleaning_example.py')) {
            const summary = buildPreprocessingSummary(raw)
            setResultText(summary)
            setBottomTab('result')
            // Show result inside Monaco as well
            setEditorLanguage('plaintext')
            setEditorValue(summary)
            setEditorPath('result.txt')
            setTimeout(() => editorRef.current?.layout?.(), 0)
          }
        } catch (e) {
          console.warn('Python run failed', e)
          appendOutput('تعذر تشغيل بايثون في المتصفح (تأكد من الاتصال بالإنترنت لتحميل Pyodide)\n')
        } finally {
          setRunning(false)
        }
      } else {
        appendOutput('لا يمكن تنفيذ الأوامر في المتصفح\n')
      }
    }
  }

  // Run the code currently in the editor (student code)
  async function runCurrentEditorPython() {
    appendOutput('$ run current code\n')
    try {
      setRunning(true)
      const code = (suppressWarnings
        ? `\nimport warnings\nwarnings.filterwarnings('ignore', category=DeprecationWarning)\nwarnings.filterwarnings('ignore', category=FutureWarning)\n` + editorValue
        : editorValue)

      await runPython(
        code,
        t => {
          if (t.trim() === '' || shouldFilterOutput(t)) return
          if (output && !output.endsWith('\n')) appendOutput('\n')
          appendOutput(t)
        },
        t => {
          if (t.trim() === '' || shouldFilterOutput(t)) return
          if (output && !output.endsWith('\n')) appendOutput('\n')
          appendOutput(t)
        }
      )
    } catch {
      appendOutput('❗ حدث خطأ أثناء التشغيل. تحقّق من الشيفرة ثم أعد المحاولة.\n')
    } finally {
      setRunning(false)
    }
  }

  // Quick helper to show a hello message in Monaco for diagnostics
  function showHelloInEditor() {
    setEditorLanguage('python')
    setEditorPath('hello.py')
    setEditorValue("# Hello from Monaco\nprint('Hello from Monaco!')\n")
    setTimeout(() => editorRef.current?.layout?.(), 0)
  }

  // On first load, put a hello message so the editor always displays content
  useEffect(() => {
    showHelloInEditor()
  }, [])

  // Public debug function
  ;(window as unknown as { debugCheckEditorState?: () => unknown }).debugCheckEditorState = () => {
    const el = editorContainerRef.current
    const size = { width: el?.clientWidth || 0, height: el?.clientHeight || 0 }
    const status = editorStatus
    const hasEditor = !!editorRef.current
    const monacoOk = !!monacoRef.current
    const logs = debugLogRef.current.slice(-20)
    console.group('[Monaco Debug]')
    console.log('container size:', size)
    console.log('status:', status)
    console.log('hasEditor:', hasEditor)
    console.log('monacoLoaded:', monacoOk)
    console.log('path:', editorPath, 'language:', editorLanguage)
    console.log('logs:', logs)
    console.groupEnd()
    return { size, status, hasEditor, monacoOk, path: editorPath, language: editorLanguage }
  }

  // Retry if container becomes visible with non-zero size but editor is missing
  useEffect(() => {
    if (containerSize.w > 0 && containerSize.h > 0 && !editorRef.current) {
      debugLogRef.current.push('[Monaco] container has size but editor missing; forcing remount')
      setEditorStatus('mounting')
      setEditorKey(k => k + 1)
    }
  }, [containerSize])



  /* ------------------------------------------------------------------ */
  /*  Render                                                            */
  /* ------------------------------------------------------------------ */
  return (
    <div
      className="app-container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        fontFamily: "'Courier New', monospace",
      }}
    >
      <header
        className="app-header"
        style={{
          padding: 12,
          borderBottom: '1px solid #ccc',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h1 style={{ margin: 0 }}>دليل التفاعل</h1>
        <ModeToggle />
      </header>

      <main
        className="app-main"
        style={{ display: 'flex', flexGrow: 1, height: '100%', gap: 12, overflow: 'hidden', minHeight: 0 }}
      >
        <nav
          className="toc-panel"
          style={{
            flex: '0 0 320px',
            overflowY: 'auto',
            borderRight: '1px solid #ccc',
            padding: '16px 12px',
            backgroundColor: '#f8f9fa',
            height: '100%',
            minHeight: 0,
          }}
        >
          {toc.map((session, si) => (
            <div
              key={si}
              style={{
                marginBottom: '24px',
                padding: '16px',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              }}
            >
              <h2
                style={{
                  margin: '0 0 8px 0',
                  fontSize: '18px',
                  fontWeight: 'bold',
                  color: '#2c3e50',
                }}
              >
                {session.label}
              </h2>
              {session.description && (
                <p
                  style={{
                    margin: '0 0 16px 0',
                    fontSize: '14px',
                    color: '#7f8c8d',
                    lineHeight: 1.4,
                  }}
                >
                  {session.description}
                </p>
              )}
              {session.lessons?.map((lesson, li) => {
                const key = `${si}-${li}`
                const selected = selectedKey === key
                return (
                  <div
                    key={key}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: selected ? '#e3f2fd' : 'transparent',
                      padding: '12px',
                      borderRadius: '6px',
                      marginBottom: '8px',
                      border: selected ? '1px solid #90caf9' : '1px solid #e0e0e0',
                      transition: 'all 0.2s ease',
                    }}
                    onClick={() => onTocItemClick(lesson, key)}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '15px',
                        color: selected ? '#1565c0' : '#34495e',
                        marginBottom: selected ? '8px' : '0',
                      }}
                    >
                      {lesson.label}
                    </div>
                    {selected && lesson.actions && lesson.actions.length > 0 && (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {lesson.actions.map((a, ai) => (
                          <button
                            key={ai}
                            style={{
                              padding: '6px 14px',
                              backgroundColor: '#2196f3',
                              color: 'white',
                              border: 'none',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              fontWeight: 500,
                              transition: 'background-color 0.2s',
                              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            }}
                            onClick={e => {
                              e.stopPropagation()
                              runAction(a)
                            }}
                            onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#1e88e5')}
                            onMouseLeave={e => (e.currentTarget.style.backgroundColor = '#2196f3')}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </nav>

        <section
          className="markdown-content"
          style={{
            flex: '1 1 40%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
            overflow: 'hidden',
            backgroundColor: '#1e1e1e',
            color: '#eee',
            padding: 12,
            fontSize: 16,
            lineHeight: 1.5,
          }}
          ref={contentRef}
        >
          {/* 1) Code Display (Sample) */}
          {sampleCode && !exerciseActive && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ marginTop: 0 }}>مثال توضيحي</h3>
              <pre style={{ background:'#111', color:'#eee', padding:12, borderRadius:6, overflowX:'auto' }}>
{sampleCode}
              </pre>
              {exercisePrompts.length > 0 && (
                <div style={{ background:'#0f172a', padding:12, borderRadius:6, marginTop:12 }}>
                  <div style={{ fontWeight:600, marginBottom:8 }}>تمرينات مقترحة</div>
                  <ul style={{ margin:0, paddingInlineStart: '1.2rem' }}>
                    {exercisePrompts.map((p, i) => (
                      <li key={i} style={{ marginBottom:6 }}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div style={{ marginTop:12 }}>
                <button onClick={()=>{ setExerciseActive(true); setEditorValue(sampleCode); setEditorLanguage('python'); runCurrentEditorPython(); }}
                        style={{ padding:'6px 12px', background:'#10b981', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
                  ابدأ التمرين
                </button>
              </div>
            </div>
          )}

          {/* 2) Original markdown content */}
          <div 
            style={{ 
              overflowY:'auto', 
              padding: '16px',
              lineHeight: '1.6',
              fontSize: '15px'
            }} 
            dangerouslySetInnerHTML={{ __html: markdownHtml }} 
          />
        </section>

        <section
          style={{
            flex: '1 1 60%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#111',
            color: '#eee',
            minHeight: 0,
            height: '100%',
          }}
        >
          <div 
            ref={editorContainerRef} 
            className="editor-container"
            style={{ 
              height: editorMaximized ? '100%' : (bottomMaximized ? '0px' : '450px'),
              minHeight: bottomMaximized ? '0px' : '450px',
              flex: editorMaximized ? '1 1 100%' : (bottomMaximized ? '0 0 0px' : '0 0 450px'),
              position: 'relative',
              backgroundColor: '#1e1e1e',
              border: '1px solid #333',
              borderRadius: '4px',
              overflow: 'hidden'
            }}
          >
            <Editor
              key={editorKey}
              height="100%"
              width="100%"
              defaultLanguage="python"
              language={editorLanguage}
              theme="vs-dark"
              value={editorValue}
              path={editorPath}
              onChange={v => setEditorValue(v ?? '')}
              onMount={(editor, monaco) => {
                editorRef.current = editor
                monacoRef.current = monaco
                setEditorStatus('ready')
                debugLogRef.current.push('[Monaco] onMount: ready')
                // Force layout after mount
                const forceLayout = () => {
                  try {
                    editor.layout()
                  } catch (e) {
                    console.warn('Editor layout failed:', e)
                  }
                }
                setTimeout(forceLayout, 0)
                setTimeout(forceLayout, 100)
                setTimeout(forceLayout, 500)
              }}
              onValidate={(markers) => {
                if (markers?.length) {
                  console.warn('[Monaco] validation markers', markers)
                }
              }}
              options={{
                fontSize: 16,
                minimap: { enabled: false },
                lineNumbers: 'on',
                automaticLayout: false, // We'll handle layout manually
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                folding: true,
                renderWhitespace: 'selection',
                readOnly: running || (!exerciseActive && !!sampleCode),
                theme: 'vs-dark',
                contextmenu: true,
                mouseWheelZoom: false,
                quickSuggestions: false,
                parameterHints: { enabled: false },
                autoClosingBrackets: 'always',
                autoClosingQuotes: 'always',
                formatOnPaste: true,
                formatOnType: true,
                glyphMargin: true,
                lineDecorationsWidth: 10,
                lineNumbersMinChars: 3,
                overviewRulerLanes: 2
              }}
            />
            {/* Fallback overlay if height is too small */}
            {(containerSize.h < 100) && (
              <div style={{ 
                position:'absolute', 
                inset:0, 
                display:'flex', 
                alignItems:'center', 
                justifyContent:'center', 
                color:'#9CA3AF', 
                pointerEvents:'none',
                backgroundColor: 'rgba(0,0,0,0.8)',
                fontSize: '14px',
                textAlign: 'center',
                padding: '20px'
              }}>
                <div>
                  <div>المحرر صغير جداً</div>
                  <div style={{ fontSize: '12px', marginTop: '8px' }}>
                    Editor container too small: {containerSize.w}×{containerSize.h}
                  </div>
                  <div style={{ fontSize: '12px', marginTop: '4px' }}>
                    Use "تكبير المحرر" button to expand
                  </div>
                </div>
              </div>
            )}
          </div>
          {/* 4) Controls for exercises */}
          <div style={{ display:'flex', gap:8, padding:'8px 12px', background:'#0b1021', borderTop:'1px solid #1f2937', flex: '0 0 auto' }}>
            <button onClick={runCurrentEditorPython}
                    disabled={running}
                    style={{ padding:'6px 12px', background:'#2563eb', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
              تشغيل (Run)
            </button>
            <button onClick={()=>{ if (sampleCode) { setEditorValue(sampleCode); setEditorLanguage('python'); } }}
                    disabled={running || !exerciseActive}
                    style={{ padding:'6px 12px', background:'#6b7280', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
              إعادة الضبط (Reset)
            </button>
            <button onClick={()=>{ setEditorMaximized(m=>!m); if (!editorMaximized) setBottomMaximized(false); }}
                    style={{ padding:'6px 12px', background:'#0ea5e9', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
              {editorMaximized ? 'تصغير المحرر' : 'تكبير المحرر'}
            </button>
            <button onClick={()=>setBottomMaximized(m=>!m)}
                    style={{ padding:'6px 12px', background:'#059669', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>
              {bottomMaximized ? 'تصغير اللوحة' : 'تكبير اللوحة'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: bottomMaximized ? '1 1 100%' : (editorMaximized ? '0 0 180' : '1 1 180') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid #1f2937', background: '#0b1021' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={()=>setBottomTab('console')} style={{ padding:'4px 10px', border:'none', borderRadius:6, cursor:'pointer', background: bottomTab==='console' ? '#2563eb' : '#374151', color:'#fff' }}>الكونسول</button>
                <button onClick={()=>setBottomTab('result')} style={{ padding:'4px 10px', border:'none', borderRadius:6, cursor:'pointer', background: bottomTab==='result' ? '#2563eb' : '#374151', color:'#fff' }}>النتيجة</button>
              </div>
              <div style={{ marginInlineStart: 'auto', display:'flex', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input type="checkbox" checked={suppressWarnings} onChange={e => setSuppressWarnings(e.currentTarget.checked)} />
                  إخفاء التحذيرات
                </label>
                <button onClick={() => { setOutput(''); setResultText('') }} style={{ padding:'4px 10px', background:'#374151', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}>مسح</button>
              </div>
            </div>
            <div ref={outputRef} style={{ flex:'1 1 auto', overflowY:'auto', background:'#111', color:'#eee', whiteSpace:'pre-wrap', padding:12, fontSize:14 }}>
              {bottomTab === 'console' ? TerminalOutput({ output }) : resultText || '— لا توجد نتيجة بعد —'}
              <div style={{ marginTop: 8, opacity: 0.7, fontSize: 12 }}>
                حالة المحرر: {editorStatus} • حاوية: {containerSize.w}×{containerSize.h}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}

// Build a formatted summary for the preprocessing lesson output
function buildPreprocessingSummary(raw: string): string {
  const lines = raw.split('\n')
  // Extract missing values section
  const mvIndex = lines.findIndex(l => /Missing values after cleaning:/i.test(l))
  const counts: Record<string, string> = { name: '0', age: '0', salary: '0', department: '0' }
  if (mvIndex !== -1) {
    for (let i = mvIndex + 1; i < Math.min(lines.length, mvIndex + 12); i++) {
      const m = lines[i].match(/^(name|age|salary|department)\s*:??\s*(\d+)/i)
      if (m) counts[m[1].toLowerCase()] = m[2]
      if (/^\s*$/.test(lines[i])) break
    }
  }
  const countsTable = buildTableString(
    ['Column', 'Count'],
    [
      ['name', counts.name],
      ['age', counts.age],
      ['salary', counts.salary],
      ['department', counts.department],
    ]
  )

  // Extract cleaned data rows
  const cdIndex = lines.findIndex(l => /Cleaned data:/i.test(l))
  const rows: (string | number)[][] = []
  if (cdIndex !== -1) {
    for (let i = cdIndex + 1; i < Math.min(lines.length, cdIndex + 30); i++) {
      const r = lines[i].match(/^\s*\d+\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)/)
      if (r) rows.push([r[1], r[2], r[3], r[4]])
      if (rows.length >= 6) break
    }
  }
  const dataTable = buildTableString(['name', 'age', 'salary', 'department'], rows)

  const title = centerLine('DATA PREPROCESSING LESSON')
  const underline = centerLine('─'.repeat('DATA PREPROCESSING LESSON'.length))
  return [
    title,
    underline,
    '',
    'Note   : Step   - Fill missing values in "department" column with "Unknown".',
    "Note   : Code   - df['department'].fillna('Unknown', inplace=True)",
    'Status : ✓ Completed',
    'Note   : ▶ Missing values after cleaning:',
    '',
    countsTable,
    '',
    'Note   : ▶ Cleaned Data:',
    '',
    dataTable,
  ].join('\n')
}

function centerLine(text: string): string {
  const maxWidth = 80
  const pad = Math.max(0, Math.floor((maxWidth - text.length) / 2))
  return ' '.repeat(pad) + text
}