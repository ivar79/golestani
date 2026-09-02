<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Factories\HasFactory; use Illuminate\Database\Eloquent\Model; use Illuminate\Database\Eloquent\Relations\BelongsTo;
class Business extends Model { use HasFactory; protected $fillable=['user_id','name','slug','category','services','description','phone','email','address','city','neighborhood','latitude','longitude','social_links','badges','status','moderation_note']; protected function casts(): array { return ['services'=>'array','social_links'=>'array','badges'=>'array','latitude'=>'float','longitude'=>'float']; } public function owner(): BelongsTo { return $this->belongsTo(User::class,'user_id'); } }
