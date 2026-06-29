import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { fetchApplicationCvUrl } from '../lib/applications'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

function normalizeHighlightTerms(highlightTerms) {
  return [...new Set(highlightTerms || [])]
    .filter((term) => term && term.trim().length >= 2)
    .map((term) => term.toLowerCase())
}

function fragmentMatchesTerms(text, normalizedTerms) {
  const fragment = text.toLowerCase()
  return normalizedTerms.some((term) => fragment.includes(term) || term.includes(fragment))
}

export default function ResumePdfModal({
  open,
  applicationId,
  candidateName = 'Candidate',
  matchPercent,
  highlightTerms = [],
  onClose,
  onError,
}) {
  const containerRef = useRef(null)
  const onErrorRef = useRef(onError)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const termsKey = useMemo(() => highlightTerms.join('\0'), [highlightTerms])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    if (!open || !applicationId) return undefined

    let pdfDoc = null
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const { url } = await fetchApplicationCvUrl(applicationId)
        pdfDoc = await pdfjsLib.getDocument(url).promise
        if (cancelled) return

        const container = containerRef.current
        if (!container) return
        container.innerHTML = ''

        const normalizedTerms = normalizeHighlightTerms(highlightTerms)

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum += 1) {
          const page = await pdfDoc.getPage(pageNum)
          if (cancelled) return

          const viewport = page.getViewport({ scale: 1.5 })
          const pageWrapper = document.createElement('div')
          pageWrapper.className = 'resume-pdf-page'

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          const context = canvas.getContext('2d')
          await page.render({ canvasContext: context, viewport, canvas }).promise
          if (cancelled) return
          pageWrapper.appendChild(canvas)

          const textLayerDiv = document.createElement('div')
          textLayerDiv.className = 'resume-pdf-text-layer'

          const textContent = await page.getTextContent()
          textContent.items.forEach((item) => {
            if (!('str' in item) || !item.str.trim()) return

            const span = document.createElement('span')
            span.textContent = item.str

            const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
            const fontHeight = Math.hypot(tx[2], tx[3])

            span.style.position = 'absolute'
            span.style.left = `${tx[4]}px`
            span.style.top = `${tx[5] - fontHeight}px`
            span.style.fontSize = `${fontHeight}px`
            span.style.whiteSpace = 'pre'
            span.style.lineHeight = '1'
            span.style.color = 'transparent'

            if (fragmentMatchesTerms(item.str, normalizedTerms)) {
              span.className = 'resume-pdf-highlight'
            }

            textLayerDiv.appendChild(span)
          })

          pageWrapper.appendChild(textLayerDiv)
          container.appendChild(pageWrapper)
        }

        if (!cancelled) {
          setLoading(false)
          requestAnimationFrame(() => {
            container.querySelector('.resume-pdf-highlight')
              ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          })
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load resume PDF'
        setError(message)
        setLoading(false)
        onErrorRef.current?.(message)
      }
    }

    load()

    return () => {
      cancelled = true
      pdfDoc?.destroy()
    }
  }, [open, applicationId, termsKey])

  if (!open) return null

  const fileName = `${candidateName.replace(/\s+/g, '_')}_CV.pdf`
  const initials = candidateName
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className="resume-viewer-overlay fixed inset-0 z-[70] flex items-center justify-center p-4 md:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-pdf-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close resume viewer" onClick={onClose} />
      <div className="resume-viewer-modal relative w-full max-w-4xl flex flex-col max-h-[90vh]">
        <div className="resume-viewer-glow" aria-hidden="true" />

        <div className="resume-viewer-header flex items-center justify-between gap-4 p-5 md:p-6 flex-shrink-0 relative">
          <div className="flex items-center gap-4 min-w-0">
            <div className="resume-viewer-avatar">{initials}</div>
            <div className="min-w-0">
              <p className="resume-viewer-kicker">Resume with JD highlights</p>
              <h2 id="resume-pdf-title" className="resume-viewer-title theme-heading truncate">
                {candidateName}
              </h2>
              <p className="resume-viewer-filename type-caption theme-muted truncate">{fileName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {matchPercent != null && (
              <div className="resume-viewer-match-pill">
                <span className="resume-viewer-match-value">{matchPercent}%</span>
                <span className="resume-viewer-match-label">match</span>
              </div>
            )}
            <button type="button" onClick={onClose} className="resume-viewer-close" aria-label="Close">
              <i className="fa-solid fa-xmark" style={{ fontSize: 14 }} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="resume-viewer-toolbar px-5 md:px-6 py-3 flex flex-wrap items-center gap-3 flex-shrink-0 relative">
          <span className="resume-legend-item">
            <span className="resume-legend-swatch cv-highlight-swatch" aria-hidden="true" />
            JD &amp; skill highlights on PDF
          </span>
          <span className="resume-legend-hint type-caption theme-muted ml-auto hidden sm:inline">
            {highlightTerms.length} terms · fragment-level matching
          </span>
        </div>

        <div className="resume-viewer-body flex-1 overflow-y-auto px-5 md:px-6 pb-5 md:pb-6 relative">
          {loading && (
            <div className="resume-pdf-loading type-body theme-muted flex items-center justify-center gap-2 py-16">
              <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
              Loading resume…
            </div>
          )}
          {error && !loading && (
            <p className="type-caption theme-muted py-8 text-center">{error}</p>
          )}
          <div
            ref={containerRef}
            className={`resume-pdf-container ${loading ? 'resume-pdf-container-hidden' : ''}`}
          />
        </div>
      </div>
    </div>
  )
}
