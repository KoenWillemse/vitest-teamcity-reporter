import { type File, type Suite, type Task, type TaskResultPack, type Test, type UserConsoleLog, type Vitest, type ErrorWithDiff } from 'vitest'
import { SuitMessage } from './messages/suite-message'
import { escape } from './escape'
import { TestMessage } from './messages/test-message'
import MissingResultError from './error/missing-result.error'

type PotentialMessage = string | (() => string | string[])
type PotentialMessages = PotentialMessage[]

interface TestRunSummary {
  failedSuitesCount: number
  totalSuitesCount: number
  failedTestsCount: number
  totalTestsCount: number
  suiteErrors: Array<{ file: string, error: string }>
}

export class Printer {
  private readonly fileMessageMap = new Map<string, PotentialMessages>()
  private readonly testConsoleMap = new Map<string, UserConsoleLog[]>()

  constructor(private readonly logger: Vitest['logger']) {
  }

  public addFile = (file: File): void => {
    const suitMessage = new SuitMessage(file.id, escape(file.name))
    const messages = [
      suitMessage.started(),
      ...file.tasks.flatMap(this.handleTask),
      suitMessage.finished()
    ]
    this.fileMessageMap.set(file.id, messages)
  }

  public addTestConsoleLog(id: string, log: UserConsoleLog): void {
    const messages = this.testConsoleMap.get(id)
    if (messages != null) {
      messages.push(log)
    } else {
      this.testConsoleMap.set(id, [log])
    }
  }

  public handeUpdate = ([id, result]: TaskResultPack): void => {
    const messages = this.fileMessageMap.get(id)
    if ((messages != null) && (result != null) && result.state !== 'run') {
      messages
        .flatMap((message: PotentialMessage) => typeof message === 'string' ? message : message())
        .forEach(message => { this.logger.console.info(message) })
      this.fileMessageMap.delete(id)
    }
  }

  private readonly handleTask = (task: Task): PotentialMessage | PotentialMessage[] => {
    if (task.type === 'test') {
      return this.handleTest(task)
    }
    if (task.type === 'suite' && task.mode === 'run') {
      return this.handleSuite(task)
    }
    return []
  }

  private readonly handleSuite = (suite: Suite): PotentialMessage[] => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const suitMessage = new SuitMessage(suite.file!.id, escape(suite.name))
    return [
      suitMessage.started(),
      ...suite.tasks.flatMap(this.handleTask),
      suitMessage.finished()
    ]
  }

  private readonly handleTest = (test: Test): PotentialMessage => {
    const testMessage = new TestMessage(test)
    if (test.mode === 'skip') {
      return testMessage.ignored()
    }
    return () => {
      const fail = (test.result == null) || test.result.state === 'fail'

      const logs = this.testConsoleMap.get(test.id) ?? []
      const logsMessages = logs.map(log => testMessage.log(log.type, log.content))
      const filedMessages = fail ? this.getTestErrors(test).map(testMessage.fail) : []

      return [
        testMessage.started(),
        ...logsMessages,
        ...filedMessages,
        testMessage.finished(test.result?.duration ?? 0)
      ].filter(Boolean)
    }
  }

  toArray<T>(array?: Nullable<Arrayable<T>>): T[] {
    if (array === null || array === undefined) {
      array = []
    }

    if (Array.isArray(array)) {
      return array
    }

    return [array]
  }

  getSuites(suites) {
    return this.toArray(suites).flatMap(s => s.type === 'suite' ? [s, ...this.getSuites(s.tasks)] : [])
  }

  isAtomTest(s) {
    return s.type === 'test' || s.type === 'custom'
  }

  getTests(files) {
    const tests = []
    const arraySuites = this.toArray(files);
    for (const s of arraySuites) {
      if (this.isAtomTest(s)) {
        tests.push(s);
      }
      else {
        for (const task of s.tasks) {
          if (this.isAtomTest(task)) {
            tests.push(task);
          }
          else {
            tests.push(...this.getTests(task));
          }
        }
      }
    }
    return tests
  }

  private readonly getTestErrors = (test: Test): ErrorWithDiff[] =>
    test.result?.errors ??
    test.suite.result?.errors ??
    test.file?.result?.errors ??
    [new MissingResultError(test)]

  public writeSummary = (): void => {
    const suites = this.getSuites(files)
    const tests = this.getTests(files)

    const failedSuites = suites.filter(i => i.result?.errors)
    const failedTests = tests.filter(i => i.result?.state === 'fail')
    const summary: TestRunSummary = {
      failedSuitesCount: failedSuites.length,
      totalSuitesCount: suites.length,
      failedTestsCount: failedTests.length,
      totalTestsCount: tests.length,
      suiteErrors: []
    }
    if (failedSuites.length > 0) {
      for (const suite of failedSuites) {
        for (const error of (suite.result?.errors || [])) {
          summary.suiteErrors.push({
            file: suite.name,
            error: error.stack
          })
        }
      }
    }

    this.printer.writeSummary(summary)
  }
}
