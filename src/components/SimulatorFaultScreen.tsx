import type { SimulatorFault } from '../simulator/fault';

export default function SimulatorFaultScreen({ fault, onHome, onLogs }: {
  fault: SimulatorFault; onHome: () => void; onLogs: () => void;
}) {
  return <div className="simulator-fault" role="group" aria-label="模拟器故障页面">
    <img className="fault-stripe" src={`${import.meta.env.BASE_URL}device/fault-stripe.svg`} alt="" />
    <div className="fault-code">{fault.code}</div>
    <div className="fault-halted">SCRIPT<br />HALTED</div>
    <div className="fault-summary" role="status">{fault.summary}</div>
    <div className="fault-report">
      <div className="fault-report-title">LINK LOG</div>
      <div className="fault-file" title={fault.sourceFile}>{fault.sourceFile}</div>
      <div className="fault-line">{fault.line ? `LINE ${fault.line}` : 'LINE --'}</div>
    </div>
    <button className="fault-home" onClick={onHome}>HOME</button>
    <button className="fault-logs" onClick={onLogs}>VIEW LOG</button>
  </div>;
}
