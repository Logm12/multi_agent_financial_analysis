import time
from fastapi import Request, HTTPException, status
from core.config import REDIS_URL
import redis

# Fallback in-memory rate limits: {ip: [timestamp1, timestamp2, ...]}
_in_memory_limits = {}

def rate_limiter(max_calls: int = 5, period_seconds: int = 60):
    """
    FastAPI dependency for IP-based rate limiting.
    Uses Redis if available, otherwise falls back to in-memory dictionary.
    """
    async def dependency(request: Request):
        # Resolve Client IP
        client_ip = request.client.host if request.client else "unknown"
        endpoint_path = request.url.path
        
        # 1. Try Redis Rate Limiter
        try:
            r = redis.from_url(REDIS_URL, socket_timeout=1)
            key = f"rate_limit:{client_ip}:{endpoint_path}"
            
            # Increment request counter
            current_calls = r.incr(key)
            if current_calls == 1:
                # Set TTL for the key
                r.expire(key, period_seconds)
                
            if current_calls > max_calls:
                ttl = r.ttl(key)
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded. Please wait {ttl} seconds before trying again."
                )
            return
        except Exception as e:
            # Fall back to in-memory rate limiter if Redis is offline or misconfigured
            pass
        except HTTPException:
            # Re-raise HTTPExceptions from Redis block
            raise
        
        # 2. In-Memory Fallback Rate Limiter
        now = time.time()
        key = f"{client_ip}:{endpoint_path}"
        
        if key not in _in_memory_limits:
            _in_memory_limits[key] = []
            
        # Remove timestamps outside the window
        _in_memory_limits[key] = [t for t in _in_memory_limits[key] if now - t < period_seconds]
        
        if len(_in_memory_limits[key]) >= max_calls:
            wait_time = int(period_seconds - (now - _in_memory_limits[key][0]))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded (in-memory). Please wait {wait_time} seconds before trying again."
            )
            
        _in_memory_limits[key].append(now)
        
    return dependency
