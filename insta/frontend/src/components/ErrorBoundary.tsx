import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    fallback?: ReactNode;
};

type State = {
    error: Error | null;
};

export default class ErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("UI error:", error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                this.props.fallback ?? (
                    <div className="error-boundary">
                        <p>Something went wrong displaying this content.</p>
                        <button
                            type="button"
                            className="btn"
                            onClick={() => this.setState({ error: null })}
                        >
                            Try again
                        </button>
                    </div>
                )
            );
        }

        return this.props.children;
    }
}
