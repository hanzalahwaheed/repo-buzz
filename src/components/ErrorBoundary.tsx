import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  message: string
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Render error in repoBuzz:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="error-fallback">
          <h1>Something broke in the dashboard.</h1>
          <p>{this.state.message}</p>
        </main>
      )
    }

    return this.props.children
  }
}
