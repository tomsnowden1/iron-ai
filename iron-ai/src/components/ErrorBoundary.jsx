import { Component } from "react";
import { Button } from "./ui";

const isDev = import.meta.env.DEV;

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("ErrorBoundary caught an error:", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="page error-boundary" role="alert">
        <h1>Something went wrong</h1>
        <p className="ui-muted">
          The app hit an unexpected error while rendering. You can try reloading the
          page.
        </p>
        {isDev && this.state.error ? (
          <pre className="error-boundary__details">
            {this.state.error?.stack ?? this.state.error?.message}
          </pre>
        ) : null}
        <Button onClick={this.handleReload}>Reload app</Button>
      </div>
    );
  }
}
