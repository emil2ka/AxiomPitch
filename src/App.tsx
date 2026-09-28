import { useState } from 'react'
import { ArrowLeft, ArrowRight, Camera, Hand, Waves } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const slides = [
  { title: 'AxiomPitch', text: 'Презентации под твоим контролем.', label: 'Титульный слайд' },
  { title: 'Свобода движения', text: 'Переключай слайды жестами и оставайся в контакте с аудиторией.', label: 'Идея' },
  { title: 'Живой силуэт', text: 'Чёрная чёлка. Синяя тень. Короткий отклик на каждую команду.', label: 'Интерфейс' },
]

export default function App() {
  const [index, setIndex] = useState(0)
  const reducedMotion = useReducedMotion()
  const slide = slides[index]

  return (
    <main className="workspace">
      <div className="notch" aria-label="Чёлка: камера ещё не подключена">
        <Camera size={18} aria-hidden="true" />
        <span>Камера не подключена</span>
      </div>
      <header className="app-header">
        <a className="brand" href="/" aria-label="AxiomPitch — главная">
          <Waves aria-hidden="true" /> AxiomPitch
        </a>
        <span className="version">Основа MVP</span>
      </header>
      <section className="presentation" aria-label="Демонстрационная презентация">
        <div className="slide-meta"><span>{slide.label}</span><span>{index + 1} / {slides.length}</span></div>
        <motion.article
          key={index}
          className="slide"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22 }}
        >
          <span className="slide-brand">AXIOMPITCH</span>
          <h1>{slide.title}</h1>
          <p>{slide.text}</p>
        </motion.article>
        <div className="presentation-controls">
          <p className="status" role="status"><Hand size={18} aria-hidden="true" /> Распознавание жестов — следующий этап</p>
          <nav aria-label="Переключение слайдов">
            <button type="button" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Предыдущий слайд"><ArrowLeft size={20} aria-hidden="true" /></button>
            <span aria-live="polite">{index + 1} / {slides.length}</span>
            <button type="button" disabled={index === slides.length - 1} onClick={() => setIndex(index + 1)} aria-label="Следующий слайд"><ArrowRight size={20} aria-hidden="true" /></button>
          </nav>
        </div>
      </section>
    </main>
  )
}
