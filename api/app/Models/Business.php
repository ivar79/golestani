<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
class Business extends Model
{
    use HasFactory;
    protected $fillable = ['user_id','designer_id','name','slug','category','services','description','phone','email','address','city','neighborhood','latitude','longitude','social_links','badges','status','moderation_note','logo','cover_image','onboarding_path','is_promoted','is_claimed','verification_level','license_tracking_code'];
    protected function casts(): array
    {
        return ['services'=>'array','social_links'=>'array','badges'=>'array','latitude'=>'float','longitude'=>'float','is_promoted'=>'boolean','is_claimed'=>'boolean','verification_level'=>'integer'];
    }
    public function owner(): BelongsTo { return $this->belongsTo(User::class, 'user_id'); }
    public function designer(): BelongsTo { return $this->belongsTo(Designer::class, 'designer_id'); }
    public function images(): HasMany { return $this->hasMany(BusinessImage::class)->orderBy('id'); }
    public function subscriptions(): HasMany { return $this->hasMany(Subscription::class); }
    public function showcases(): HasMany { return $this->hasMany(Showcase::class); }
    public function advertisements(): HasMany { return $this->hasMany(Advertisement::class); }
    public function reports(): HasMany { return $this->hasMany(BusinessReport::class); }
    public function cards(): HasMany { return $this->hasMany(BusinessCard::class); }
}
