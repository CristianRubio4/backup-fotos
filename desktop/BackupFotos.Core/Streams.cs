using System.Security.Cryptography;

namespace BackupFotos.Core;

/// <summary>Escribe en otro stream y calcula a la vez la huella SHA-256 de lo escrito.</summary>
public sealed class HashingStream(Stream inner, Action<long>? onBytes = null) : Stream
{
    readonly IncrementalHash _hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);

    public long Written { get; private set; }

    public string Hash() => Convert.ToHexString(_hash.GetHashAndReset()).ToLowerInvariant();

    public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));

    public override void Write(ReadOnlySpan<byte> buffer)
    {
        inner.Write(buffer);
        _hash.AppendData(buffer);
        Written += buffer.Length;
        onBytes?.Invoke(buffer.Length);
    }

    public override void WriteByte(byte value) => Write([value]);

    public override void Flush() => inner.Flush();
    public override bool CanRead => false;
    public override bool CanSeek => false;
    public override bool CanWrite => true;
    public override long Length => Written;
    public override long Position { get => Written; set => throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();

    protected override void Dispose(bool disposing)
    {
        if (disposing) _hash.Dispose();
        base.Dispose(disposing);
    }
}

/// <summary>Velocidad media de los últimos segundos.</summary>
public sealed class SpeedMeter
{
    readonly Queue<(TimeSpan T, long Bytes)> _samples = new();

    public double Rate { get; private set; }

    public void Sample(TimeSpan t, long bytes)
    {
        _samples.Enqueue((t, bytes));
        while (_samples.Count > 2 && t - _samples.Peek().T > TimeSpan.FromSeconds(8)) _samples.Dequeue();
        var (t0, b0) = _samples.Peek();
        var dt = (t - t0).TotalSeconds;
        Rate = dt > 0.5 ? Math.Max(0, (bytes - b0) / dt) : Rate;
    }
}
